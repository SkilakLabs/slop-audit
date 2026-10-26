# Hosting the public app

ECS Fargate, one task, behind an application load balancer with an ACM
certificate. Reports, screenshots and feedback live on EFS. Images are built
by GitHub Actions and pushed to a private ECR repository. Everything is in
[infra/slop-audit.yaml](../infra/slop-audit.yaml); the stack is created and
updated by [scripts/deploy.sh](../scripts/deploy.sh); the app is shipped by
[.github/workflows/deploy.yml](../.github/workflows/deploy.yml) on every merge
to main.

Why Fargate and not a plain instance: new accounts often have a tiny EC2
on-demand vCPU quota, and Fargate has its own, separate quota.

## What runs

- Image: `mcr.microsoft.com/playwright:v1.64.1-noble` plus this app, as the
  unprivileged `pwuser`. Same Playwright version as `package.json`.
- Task: 1 vCPU, 4 GB, `slop-audit serve --public` on port 4100.
- ALB: 443 with TLS 1.2/1.3 and the ACM certificate, 80 redirects. Health
  check on `/healthz`.
- EFS at `/data`: `out/<host>/...` and `out/feedback.jsonl`. Encrypted,
  retained if the stack is deleted.
- Logs: CloudWatch, 30 days. ECS Exec is on for a shell inside the task.

## What public mode changes in the app

| Limit | Default | Why |
|---|---|---|
| One scan at a time | fixed | Chromium is the cost; parallel scans just slow each other down |
| Queue | 5 waiting | Beyond that the form says "try again in a few minutes" |
| Per address | 5 scans per hour | Enough to check your own sites, not enough to scan the internet |
| Per day | 300 scans | A ceiling on the bill and on the disk |
| Fresh reports | 10 minutes | A repeat request for the same host gets the existing report |
| Retention | 1000 newest reports | Older folders are deleted after each scan |
| Automatic rescans | 48 per day, checked every 30 minutes | A report older than 7 days is re-scanned in the background, outside the user limits |
| Feedback | 10 per address per hour | Text is capped at 2000 characters |

Also: the server refuses to scan itself, `facts.json` is not served (it holds
the page's full text), the feedback list page is off, and the client address
is the last `X-Forwarded-For` entry, the one the ALB appends. Keep the DNS
record unproxied: behind a CDN proxy every caller would share the proxy's
addresses and the per-address limit would stop working. Change the numbers in
`createServer()`.

## First deploy

```
scripts/deploy.sh <domain>
```

Sign in to AWS first with credentials that can create IAM roles (set
`AWS_PROFILE` if that is not your default). The script prints two DNS records
to add at your DNS host as it goes:

1. The certificate validation CNAME. The stack waits until it resolves.
2. The site CNAME, `<domain>` to the load balancer's DNS name. DNS only, or
   proxied with TLS to the origin set to full and strict.

Set `OPERATOR_PRINCIPAL_ARN` to the IAM role you use day to day and the stack
also creates a narrow operator role that can run the service's task definition
once with a command override, for chores such as editing `/data/hidden.txt`.

On the first run the ECR repository is empty, so the service starts with zero
tasks; the script then triggers the deploy workflow, which builds and pushes
the image and sets the service to one task.

## Updating

Merge to main. The deploy workflow tests, builds, pushes `:latest` and
`:<sha>`, restarts the service and waits for it to be stable. About five
minutes. A scan in progress at that moment is lost; reports are not.

Infrastructure changes (anything in `infra/`) go through
`scripts/deploy.sh <domain>` again after merging.

## Operating

- Health: `https://<domain>/healthz` returns the running host and queue
  length.
- Logs: CloudWatch log group created by the stack, stream prefix `app`.
- Shell: `aws ecs execute-command --cluster slop-audit --task <id> --container app --interactive --command /bin/bash`.
  Feedback is at `/data/out/feedback.jsonl`.
- Cost: the load balancer and one always-on 1 vCPU task are most of it;
  EFS, ECR and logs are a few dollars. Expect on the order of 60 USD a month
  at us-east-1 prices.

## Tearing down

`aws cloudformation delete-stack --stack-name slop-audit`. The EFS file system
and the ECR repository are retained; delete them by hand if you mean it.
