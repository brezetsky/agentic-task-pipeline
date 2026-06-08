# ---------------------------------------------------------------------------
# rds.tf
#
# Postgres for self-hosted Temporal's persistence.
#
# DEV-SIZED ON PURPOSE: db.t3.micro / 20 GB / single-AZ / no final snapshot.
# This is fine for a demo but NOT production: no high availability, no
# automated final snapshot on destroy, minimal storage/compute. For production
# bump the instance class, enable multi_az, set deletion_protection = true,
# remove skip_final_snapshot, and place it in private subnets.
#
# Temporal's auto-setup image creates its own schema on first boot
# (SKIP_DB_CREATE=false, see ecs.tf), so we only provision the empty database.
# ---------------------------------------------------------------------------

# Subnet group spanning the default subnets. RDS needs subnets in >= 2 AZs;
# the default VPC provides one subnet per AZ, which satisfies that.
#
# PRODUCTION CAVEAT: these default subnets are public. A real DB belongs in
# private subnets with no internet route.
resource "aws_db_subnet_group" "this" {
  name        = "${var.project_name}-db"
  description = "Subnet group for ${var.project_name} RDS (default subnets)."
  subnet_ids  = data.aws_subnets.default.ids

  tags = { Name = "${var.project_name}-db" }
}

resource "aws_db_instance" "temporal" {
  identifier = "${var.project_name}-temporal"

  # Engine: Postgres 16. Temporal's DB plugin is selected via the DB=postgres12
  # env on the Temporal container (its driver name), independent of the server
  # version here.
  engine         = "postgres"
  engine_version = "16"

  instance_class    = "db.t3.micro" # dev-sized
  allocated_storage = 20            # GiB
  storage_type      = "gp3"

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password # from a sensitive variable; never hardcoded

  # Networking: private to the VPC, reachable only from the ECS tasks SG.
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  multi_az = false # dev-sized: no standby

  # Demo lifecycle: allow clean teardown without a final snapshot. Do NOT do
  # this in production — you want a final snapshot and deletion protection.
  skip_final_snapshot = true

  # Encrypt storage at rest with the default AWS-managed KMS key. Cheap, sane
  # default even for a demo.
  storage_encrypted = true

  tags = { Name = "${var.project_name}-temporal-db" }
}
