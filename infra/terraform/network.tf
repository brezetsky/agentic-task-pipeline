# ---------------------------------------------------------------------------
# network.tf
#
# Networking + security groups.
#
# PRODUCTION CAVEAT: This stack intentionally reuses the account's DEFAULT VPC
# and its (public) subnets via data sources, to keep the example self-contained
# and cheap to reason about. A real deployment should provision a DEDICATED VPC
# with PRIVATE subnets for the ECS tasks and RDS, plus NAT gateways (or VPC
# endpoints) for outbound image pulls and AWS API access. The Fargate tasks
# below run in the default/public subnets with assign_public_ip = true purely
# so they can reach ECR / the internet to pull images without a NAT gateway.
# ---------------------------------------------------------------------------

# The account's default VPC.
data "aws_vpc" "default" {
  default = true
}

# All subnets in the default VPC. In the default VPC these are public (they
# have a route to an internet gateway), which is why tasks get public IPs.
data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# --------------------------------------------------------------------------
# Security groups
#
# Traffic model:
#   internet --(80)--> [alb] --(3001)--> [ecs:api]
#   [ecs:*] --(7233 gRPC, 8080 UI)--> [ecs:*]   (intra-cluster, self-referencing)
#   [ecs:*] --(5432)--> [rds]
# --------------------------------------------------------------------------

# ALB security group: accepts public HTTP on 80, can talk to anything outbound
# (so it can forward to the ECS tasks).
resource "aws_security_group" "alb" {
  name        = "${var.project_name}-alb"
  description = "ALB: allow inbound HTTP from the internet."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP from anywhere (demo). Add HTTPS:443 + ACM cert for production."
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound (forward to ECS targets)."
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-alb" }
}

# ECS tasks security group. Inbound rules are defined as separate
# aws_vpc_security_group_ingress_rule resources so the self-referencing rules
# (intra-cluster Temporal traffic) can reference this SG's own id without a
# cycle inside the resource block.
resource "aws_security_group" "ecs" {
  name        = "${var.project_name}-ecs"
  description = "ECS Fargate tasks: app + Temporal traffic."
  vpc_id      = data.aws_vpc.default.id

  egress {
    description = "All outbound (pull images, reach Secrets Manager, RDS, internet)."
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-ecs" }
}

# api listens on 3001 and is only reached via the ALB.
resource "aws_vpc_security_group_ingress_rule" "ecs_api_from_alb" {
  security_group_id            = aws_security_group.ecs.id
  description                  = "api 3001 from the ALB only."
  from_port                    = 3001
  to_port                      = 3001
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.alb.id
}

# Temporal gRPC (7233): reachable from other tasks in the cluster (worker, api,
# temporal-ui). Self-referencing so only members of this SG can connect.
resource "aws_vpc_security_group_ingress_rule" "ecs_temporal_grpc_self" {
  security_group_id            = aws_security_group.ecs.id
  description                  = "Temporal gRPC 7233 intra-cluster (self)."
  from_port                    = 7233
  to_port                      = 7233
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.ecs.id
}

# Temporal UI (8080): intra-cluster only here (the UI is not exposed publicly in
# this example). Self-referencing.
resource "aws_vpc_security_group_ingress_rule" "ecs_temporal_ui_self" {
  security_group_id            = aws_security_group.ecs.id
  description                  = "Temporal UI 8080 intra-cluster (self)."
  from_port                    = 8080
  to_port                      = 8080
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.ecs.id
}

# RDS security group: Postgres 5432 reachable ONLY from the ECS tasks SG.
resource "aws_security_group" "rds" {
  name        = "${var.project_name}-rds"
  description = "RDS Postgres: allow 5432 from ECS tasks only."
  vpc_id      = data.aws_vpc.default.id

  egress {
    description = "All outbound."
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-rds" }
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_ecs" {
  security_group_id            = aws_security_group.rds.id
  description                  = "Postgres 5432 from ECS tasks only."
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.ecs.id
}
