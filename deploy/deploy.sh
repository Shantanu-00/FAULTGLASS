#!/usr/bin/env bash
# Build the backend image, push it to Lightsail and roll out the six-container deployment.
# Needs: docker, aws CLI with Lightsail access, and a repo-root .env with DATABASE_URL,
# CORS_ORIGINS (the Vercel origin), MODEL_API_KEY, BASETEN_API_KEY and EDGE_API_KEY.
#
#   deploy/deploy.sh            # create the service if missing, push, deploy
#
# Optional environment: AWS_REGION, SERVICE (default faultglass), POWER (default small).
set -euo pipefail

cd "$(dirname "$0")/.."
SERVICE="${SERVICE:-faultglass}"
POWER="${POWER:-small}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region || true)}}"
[ -n "$REGION" ] || { echo "set AWS_REGION" >&2; exit 1; }
LS=(aws lightsail --region "$REGION")

python3 deploy/render.py ":placeholder" >/dev/null   # fail early on missing values

docker build -f backend/Dockerfile -t "${SERVICE}-backend" .

if ! "${LS[@]}" get-container-services --service-name "$SERVICE" >/dev/null 2>&1; then
  "${LS[@]}" create-container-service --service-name "$SERVICE" --power "$POWER" --scale 1
  echo "waiting for the service to become ready"
  until [ "$("${LS[@]}" get-container-services --service-name "$SERVICE" \
      --query 'containerServices[0].state' --output text)" = "READY" ]; do sleep 10; done
fi

IMAGE="$("${LS[@]}" push-container-image --service-name "$SERVICE" --label backend \
  --image "${SERVICE}-backend" --query 'containerImage.image' --output text)"

python3 deploy/render.py "$IMAGE"
"${LS[@]}" create-container-service-deployment --service-name "$SERVICE" \
  --containers file://deploy/containers.json --public-endpoint file://deploy/endpoint.json \
  --query 'containerService.state' --output text

"${LS[@]}" get-container-services --service-name "$SERVICE" \
  --query 'containerServices[0].url' --output text
echo "Set VITE_API_URL on Vercel to that URL and CORS_ORIGINS in .env to the Vercel origin."
