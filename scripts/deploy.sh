#!/usr/bin/env bash
# Create or update the public site's infrastructure, then ship the current main.
#   scripts/deploy.sh <domain>
# Set OPERATOR_PRINCIPAL_ARN to the IAM role you use for operator chores day to
# day; the stack then creates a narrow operator role it can assume.
# Stack operations create IAM roles, so run this with credentials that may
# (set AWS_PROFILE if that is not your default). Day-to-day deploys do not
# need this script: merging to main runs .github/workflows/deploy.yml.
set -euo pipefail
cd "$(dirname "$0")/.."
DOMAIN=${1:?usage: scripts/deploy.sh <domain>}
export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-us-east-1}
STACK=${STACK:-slop-audit}

VPC=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SUBNETS=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC" Name=default-for-az,Values=true --query 'sort_by(Subnets,&AvailabilityZone)[:2].SubnetId' --output text | tr '\t' ',')
[ "$VPC" != None ] && [ -n "$SUBNETS" ] || { echo "No default VPC with two subnets found." >&2; exit 1; }

# GitHub's immutable OIDC subject names the owner and repository by id.
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
IDS=$(gh api "repos/$REPO" --jq '[.owner.id, .id] | @tsv')
IMMUTABLE="${REPO%/*}@$(echo "$IDS" | cut -f1)/${REPO#*/}@$(echo "$IDS" | cut -f2)"

# The service can only start once an image exists; the deploy workflow pushes the first one.
IMAGES=$(aws ecr describe-images --repository-name "$STACK" --query 'length(imageDetails)' --output text 2>/dev/null || echo 0)
DESIRED=$([ "$IMAGES" -gt 0 ] && echo 1 || echo 0)

echo "Stack $STACK for https://$DOMAIN (vpc $VPC, subnets $SUBNETS, images in ECR: $IMAGES)"
aws cloudformation deploy --stack-name "$STACK" --template-file infra/slop-audit.yaml \
  --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset \
  --parameter-overrides "DomainName=$DOMAIN" "VpcId=$VPC" "SubnetIds=$SUBNETS" "DesiredCount=$DESIRED" \
    "GitHubRepo=$REPO" "GitHubRepoImmutable=$IMMUTABLE" "OperatorPrincipalArn=${OPERATOR_PRINCIPAL_ARN:-}" &
DEPLOY_PID=$!

# While the stack waits on certificate validation, print the CNAME it needs.
SHOWN=""
while kill -0 $DEPLOY_PID 2>/dev/null; do
  if [ -z "$SHOWN" ]; then
    CERT=$(aws cloudformation describe-stack-resource --stack-name "$STACK" --logical-resource-id Certificate --query 'StackResourceDetail.PhysicalResourceId' --output text 2>/dev/null || true)
    if [ -n "$CERT" ] && [ "$CERT" != None ]; then
      REC=$(aws acm describe-certificate --certificate-arn "$CERT" --query 'Certificate.DomainValidationOptions[0].ResourceRecord.[Name,Value]' --output text 2>/dev/null || true)
      if [ -n "$REC" ] && [ "$REC" != "None	None" ]; then
        echo; echo "DNS record 1 (certificate validation, add it now; the stack waits for it):"
        echo "  CNAME  $(echo "$REC" | cut -f1)  ->  $(echo "$REC" | cut -f2)"; echo
        SHOWN=1
      fi
    fi
  fi
  sleep 10
done
wait $DEPLOY_PID

OUT=$(aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].Outputs' --output json)
out() { echo "$OUT" | python3 -c 'import json,sys; print({o["OutputKey"]:o["OutputValue"] for o in json.load(sys.stdin)}[sys.argv[1]])' "$1"; }
ALB=$(out AlbDnsName)

if [ "$DESIRED" = 0 ]; then
  echo "First deploy: building and pushing the image through GitHub Actions."
  gh workflow run deploy.yml --ref main
  sleep 15
  RUN=$(gh run list --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')
  gh run watch "$RUN" --exit-status
fi

echo
echo "DNS record 2 (the site):  CNAME  $DOMAIN  ->  $ALB"
echo "At your DNS host: DNS only, or proxied with TLS to the origin set to full and strict."
echo "Repository variable for the deploy workflow:  gh variable set AWS_DEPLOY_ROLE_ARN --body $(out DeployRoleArn)"
echo "Check: curl -sI https://$DOMAIN/healthz"
echo "Shell: aws ecs execute-command --cluster $STACK --task <task-id> --container app --interactive --command /bin/bash"
