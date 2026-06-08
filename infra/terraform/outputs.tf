# ---------------------------------------------------------------------------
# outputs.tf
#
# Handy values after an apply: the public app URL and the ECR/RDS endpoints.
# ---------------------------------------------------------------------------

output "alb_dns_name" {
  description = "Public DNS name of the ALB. Open http://<this> to reach the app."
  value       = aws_lb.app.dns_name
}

output "api_ecr_repository_url" {
  description = "ECR repository URL to push the api image to."
  value       = aws_ecr_repository.api.repository_url
}

output "worker_ecr_repository_url" {
  description = "ECR repository URL to push the worker image to."
  value       = aws_ecr_repository.worker.repository_url
}

output "rds_endpoint" {
  description = "RDS Postgres connection endpoint (host:port) used as POSTGRES_SEEDS."
  value       = aws_db_instance.temporal.endpoint
}
