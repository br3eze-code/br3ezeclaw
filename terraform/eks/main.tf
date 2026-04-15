terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "region" { default = "us-east-1" }
variable "cluster_name" { default = "agentos-prod" }
variable "vpc_cidr" { default = "10.0.0.0/16" }

# VPC
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
  version = "5.5.0"

  name = "${var.cluster_name}-vpc"
  cidr = var.vpc_cidr

  azs = ["${var.region}a", "${var.region}b", "${var.region}c"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]

  enable_nat_gateway = true
  single_nat_gateway = true
  enable_dns_hostnames = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
  }
}

# EKS
module "eks" {
  source = "terraform-aws-modules/eks/aws"
  version = "20.8.0"

  cluster_name = var.cluster_name
  cluster_version = "1.29"

  vpc_id = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  cluster_endpoint_public_access = true

  eks_managed_node_groups = {
    default = {
      min_size = 1
      max_size = 3
      desired_size = 2

      instance_types = ["t3.medium"]
      capacity_type = "ON_DEMAND"

      iam_role_additional_policies = {
        AmazonEBSCSIDriverPolicy = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
      }
    }
  }

  # IRSA for AgentOS AWS skill
  enable_irsa = true
}

# IAM Role for AgentOS pods to use AWS skill
module "agentos_irsa" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "5.39.0"

  role_name = "${var.cluster_name}-agentos"

  oidc_providers = {
    main = {
      provider_arn = module.eks.oidc_provider_arn
      namespace_service_accounts = ["agentos:agentos"]
    }
  }

  role_policy_arns = {
    ec2_read = "arn:aws:iam::aws:policy/AmazonEC2ReadOnlyAccess"
    s3_read = "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"
    # Add EC2RebootInstances if you want skill to reboot
  }
}

# Outputs
output "cluster_endpoint" { value = module.eks.cluster_endpoint }
output "cluster_name" { value = module.eks.cluster_name }
output "agentos_role_arn" { value = module.agentos_irsa.iam_role_arn }
output "kubeconfig" {
  value = <<EOT
apiVersion: v1
kind: Config
clusters:
- name: ${var.cluster_name}
  cluster:
    server: ${module.eks.cluster_endpoint}
    certificate-authority-data: ${module.eks.cluster_certificate_authority_data}
contexts:
- name: ${var.cluster_name}
  context:
    cluster: ${var.cluster_name}
    user: ${var.cluster_name}
current-context: ${var.cluster_name}
users:
- name: ${var.cluster_name}
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: aws
      args: [eks, get-token, --cluster-name, ${var.cluster_name}]
EOT
  sensitive = true
}
