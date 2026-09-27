FROM jenkins/jenkins:lts-jdk17

USER root

# ============================================================
# Install required system packages
# ============================================================

RUN apt-get update && \
    apt-get install -y \
        ca-certificates \
        curl \
        gnupg \
        jq \
        unzip \
        chromium \
        git && \
    rm -rf /var/lib/apt/lists/*

# ============================================================
# Install Docker CLI and Docker Compose
# ============================================================

RUN curl -fsSL https://download.docker.com/linux/debian/gpg | \
    gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian bookworm stable" \
    > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y \
        docker-ce-cli \
        docker-compose-plugin && \
    rm -rf /var/lib/apt/lists/*

# ============================================================
# Install Node.js 20
# ============================================================

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# ============================================================
# Install Trivy
# ============================================================

RUN curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | \
    sh -s -- -b /usr/local/bin

# ============================================================
# Install Jenkins plugins
# ============================================================

COPY jenkins/plugins/plugins.txt /usr/share/jenkins/ref/plugins.txt

RUN jenkins-plugin-cli \
    --plugin-file /usr/share/jenkins/ref/plugins.txt

# ============================================================
# Docker socket access
# ============================================================

RUN usermod -aG 0 jenkins

USER jenkins