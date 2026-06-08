# ---------------------------------------------------------------------------
# versions.tf
#
# Terraform + provider version constraints, and the AWS provider config.
#
# NOTE: This configuration is illustrative and is NOT intended to be applied.
# It is committed so reviewers can see the deployable *shape* of the system.
# It is written to pass `terraform validate` against AWS provider v5.
# ---------------------------------------------------------------------------

terraform {
  # Require a reasonably modern Terraform. The HCL here (optional object
  # attributes are not used) is compatible with 1.3+, but we pin a recent
  # floor to get stable behavior from the AWS provider below.
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # Pin to the AWS provider v5 major line. All resource and attribute
      # names in this codebase target the v5 schema.
      version = "~> 5.0"
    }
  }

  # For a real deployment, configure a remote backend (e.g. S3 + DynamoDB lock)
  # here so state is shared and locked across the team. Left unconfigured on
  # purpose: this code is not applied, and a local backend keeps `validate`
  # frictionless.
  #
  # backend "s3" {
  #   bucket         = "my-tfstate-bucket"
  #   key            = "agent-pipeline/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "my-tf-locks"
  #   encrypt        = true
  # }
}

# Default AWS provider. Region comes from the `aws_region` variable so the
# whole stack can be retargeted without code edits. Credentials are taken from
# the standard AWS provider chain (env vars, shared config/credentials file,
# SSO, instance profile, etc.) — never hardcode them here.
provider "aws" {
  region = var.aws_region

  # Tags applied to every taggable resource created by this provider. Useful
  # for cost allocation and for finding everything this stack owns.
  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}
