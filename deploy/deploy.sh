#!/usr/bin/env bash
# Roll out the six-container deployment to AWS Lightsail Containers.
#
# Default: no local Docker. GitHub Actions (.github/workflows/backend-image.yml) builds the image
# and publishes it to ghcr.io; Lightsail pulls it from there. The GHCR package must be public.
#   deploy/deploy.sh                       # uses ghcr.io/shantanu-00/faultglass-backend:latest
#   IMAGE=ghcr.io/shantanu-00/faultglass-backend:sha-abc1234 deploy/deploy.sh
#   LOCAL_DOCKER=1 deploy/deploy.sh        # build here and push through Lightsail instead
#
# Needs the aws CLI with Lightsail permissions and a repo-root .env with DATABASE_URL,
# CORS_ORIGINS (the Vercel origin), MODEL_API_KEY, BASETEN_API_KEY and EDGE_API_KEY.
# Optional environment: AWS_REGION (default eu-west-3), SERVICE (default faultglass),
# POWER (default medium).
set -euo pipefail

cd "$(dirname "$0")/.."
SERVICE="${SERVICE:-faultglass}"
POWER="${POWER:-medium}"
REGION="${AWS_REGION:-eu-west-3}"
LS=(aws lightsail --region "$REGION")

python3 deploy/render.py ":placeholder" >/dev/null   # fail early on missing values

if ! "${LS[@]}" get-container-services --service-name "$SERVICE" >/dev/null 2>&1; then
  "${LS[@]}" create-container-service --service-name "$SERVICE" --power "$POWER" --scale 1
  echo "waiting for the service to become ready"
  until [ "$("${LS[@]}" get-container-services --service-name "$SERVICE" \
      --query 'containerServices[0].state' --output text)" = "READY" ]; do sleep 10; done
fi

if [ "${LOCAL_DOCKER:-0}" = "1" ]; then
  docker build -f backend/Dockerfile -t "${SERVICE}-backend" .
  IMAGE="$("${LS[@]}" push-container-image --service-name "$SERVICE" --label backend \
    --image "${SERVICE}-backend" --query 'containerImage.image' --output text)"
else
  IMAGE="${IMAGE:-ghcr.io/shantanu-00/faultglass-backend:latest}"
fi

python3 deploy/render.py "$IMAGE"
"${LS[@]}" create-container-service-deployment --service-name "$SERVICE" \
  --containers file://deploy/containers.json --public-endpoint file://deploy/endpoint.json \
  --query 'containerService.state' --output text

echo "image: $IMAGE"
"${LS[@]}" get-container-services --service-name "$SERVICE" \
  --query 'containerServices[0].url' --output text
echo "Set VITE_API_URL on Vercel to that URL and CORS_ORIGINS in .env to the Vercel origin."
