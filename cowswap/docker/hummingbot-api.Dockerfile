ARG HUMMINGBOT_API_IMAGE=hummingbot/hummingbot-api@sha256:33b6b4e0b7adfc35aa3cf51b90625e5aa8b4dfbb2ebb335d55fded27f0e8f1ac

FROM ${HUMMINGBOT_API_IMAGE}

USER root

WORKDIR /opt/hummingbot-dex-connectors
COPY cowswap ./cowswap

RUN python -m pip install --no-cache-dir ./cowswap \
    && python -c "import hummingbot_cowswap"
