#!/bin/bash

# MikroTik Firebase Auth Server Deployment Script

set -e

echo "🚀 Starting deployment..."

# Configuration
PROJECT_NAME="mikrotik-auth"
REGION="us-central1"
SERVICE_ACCOUNT="mikrotik-auth-sa"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    command -v gcloud >/dev/null 2>&1 || { log_error "gcloud CLI not installed"; exit 1; }
    command -v docker >/dev/null 2>&1 || { log_error "Docker not installed"; exit 1; }
    
    gcloud config get-value project >/dev/null 2>&1 || { log_error "gcloud not authenticated"; exit 1; }
    
    log_info "Prerequisites check passed"
}

# Setup environment
setup_environment() {
    log_info "Setting up environment..."
    
    if [ ! -f .env ]; then
        log_error ".env file not found. Please create it from .env.example"
        exit 1
    fi
    
    # Load environment variables
    export $(grep -v '^#' .env | xargs)
    
    # Validate required variables
    required_vars=("FIREBASE_DATABASE_URL" "MIKROTIK_HOST" "MIKROTIK_PASSWORD" "SERVER_URL")
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            log_error "Required variable $var not set in .env"
            exit 1
        fi
    done
}

# Build and push container
build_and_push() {
    log_info "Building Docker image..."
    
    IMAGE_TAG="gcr.io/$(gcloud config get-value project)/$PROJECT_NAME:$(git rev-parse --short HEAD)"
    LATEST_TAG="gcr.io/$(gcloud config get-value project)/$PROJECT_NAME:latest"
    
    docker build -t $IMAGE_TAG -t $LATEST_TAG .
    
    log_info "Pushing to Container Registry..."
    docker push $IMAGE_TAG
    docker push $LATEST_TAG
    
    echo $IMAGE_TAG > .image_tag
}

# Deploy to Cloud Run
deploy_cloud_run() {
    log_info "Deploying to Cloud Run..."
    
    IMAGE_TAG=$(cat .image_tag)
    
    # Create service account if not exists
    gcloud iam service-accounts describe $SERVICE_ACCOUNT@$GOOGLE_CLOUD_PROJECT.iam.gserviceaccount.com >/dev/null 2>&1 || {
        log_info "Creating service account..."
        gcloud iam service-accounts create $SERVICE_ACCOUNT \
            --display-name="MikroTik Auth Service"
    }
    
    # Deploy
    gcloud run deploy $PROJECT_NAME \
        --image $IMAGE_TAG \
        --platform managed \
        --region $REGION \
        --allow-unauthenticated \
        --service-account $SERVICE_ACCOUNT@$GOOGLE_CLOUD_PROJECT.iam.gserviceaccount.com \
        --set-env-vars="NODE_ENV=production" \
        --set-env-vars="FIREBASE_DATABASE_URL=$FIREBASE_DATABASE_URL" \
        --set-env-vars="MIKROTIK_HOST=$MIKROTIK_HOST" \
        --set-env-vars="MIKROTIK_PASSWORD=$MIKROTIK_PASSWORD" \
        --set-env-vars="MIKROTIK_REST_URL=$MIKROTIK_REST_URL" \
        --set-env-vars="SERVER_URL=$SERVER_URL" \
        --set-env-vars="ALLOWED_ORIGINS=$ALLOWED_ORIGINS" \
        --set-env-vars="WEBHOOK_SECRET=$WEBHOOK_SECRET" \
        --set-env-vars="GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" \
        --set-env-vars="GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET" \
        --memory 512Mi \
        --cpu 1 \
        --concurrency 80 \
        --max-instances 10 \
        --min-instances 1 \
        --timeout 300 \
        --port 3000
    
    log_info "Deployment complete!"
    log_info "Service URL: $(gcloud run services describe $PROJECT_NAME --region $REGION --format 'value(status.url)')"
}

# Setup Firebase
setup_firebase() {
    log_info "Setting up Firebase..."
    
    # Enable Firestore
    gcloud services enable firestore.googleapis.com
    
    # Create Firestore indexes
    firebase deploy --only firestore:indexes || log_warn "Firestore indexes deployment skipped"
    
    # Deploy security rules
    firebase deploy --only firestore:rules || log_warn "Firestore rules deployment skipped"
}

# Main deployment
main() {
    check_prerequisites
    setup_environment
    
    case "${1:-all}" in
        build)
            build_and_push
            ;;
        deploy)
            deploy_cloud_run
            ;;
        firebase)
            setup_firebase
            ;;
        all)
            build_and_push
            deploy_cloud_run
            setup_firebase
            ;;
        *)
            echo "Usage: $0 [build|deploy|firebase|all]"
            exit 1
            ;;
    esac
    
    log_info "✅ Deployment completed successfully!"
}

main "$@"

# Build and deploy to Google Cloud Run
gcloud builds submit --tag gcr.io/PROJECT_ID/firebase-mikrotik-auth

gcloud run deploy firebase-mikrotik-auth \
  --image gcr.io/PROJECT_ID/firebase-mikrotik-auth \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="FIREBASE_DATABASE_URL=https://your-project.firebaseio.com" \
  --set-env-vars="MIKROTIK_API_URL=https://your-router-ip/rest"