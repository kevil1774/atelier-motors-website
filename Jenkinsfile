pipeline {
    agent any

    options {
        timestamps()
        timeout(time: 30, unit: 'MINUTES')

        buildDiscarder(
            logRotator(
                numToKeepStr: '10',
                artifactNumToKeepStr: '10'
            )
        )

        disableConcurrentBuilds()
    }

    environment {
        APP_NAME = 'atelier-motors'

        BACKEND_IMAGE = 'atelier-motors-backend'
        FRONTEND_IMAGE = 'atelier-motors-frontend'

        DOCKERHUB_NAMESPACE = 'kevilpatel17'

        TEST_MONGODB_URI = 'mongodb://atelier-test-mongodb:27017/atelier-motors-test'
    }

    stages {

        stage('BUILD') {
            steps {
                script {
                    env.APP_VERSION = "1.0.${env.BUILD_NUMBER}"

                    env.GIT_SHA = sh(
                        script: 'git rev-parse --short=7 HEAD',
                        returnStdout: true
                    ).trim()

                    env.VERSION_TAG = "${env.APP_VERSION}"
                    env.SHA_TAG = "${env.APP_VERSION}-${env.GIT_SHA}"
                    env.RELEASE_TAG = "v${env.APP_VERSION}"

                    echo "========================================"
                    echo "Atelier Motors Build"
                    echo "========================================"
                    echo "Application : ${env.APP_NAME}"
                    echo "Version     : ${env.APP_VERSION}"
                    echo "Git SHA     : ${env.GIT_SHA}"
                    echo "Version tag : ${env.VERSION_TAG}"
                    echo "SHA tag     : ${env.SHA_TAG}"
                    echo "Release tag : ${env.RELEASE_TAG}"
                    echo "========================================"

                    sh """
                        docker build \
                            -f backend/Dockerfile \
                            -t ${BACKEND_IMAGE}:${VERSION_TAG} \
                            -t ${BACKEND_IMAGE}:${SHA_TAG} \
                            .
                    """

                    sh """
                        docker build \
                            -f frontend/Dockerfile \
                            -t ${FRONTEND_IMAGE}:${VERSION_TAG} \
                            -t ${FRONTEND_IMAGE}:${SHA_TAG} \
                            .
                    """

                    sh '''
                        rm -rf build-artifacts
                        mkdir -p build-artifacts
                    '''

                    sh """
                        echo "Application: ${APP_NAME}" \
                            > build-artifacts/build-info.txt

                        echo "Version: ${VERSION_TAG}" \
                            >> build-artifacts/build-info.txt

                        echo "Git SHA: ${GIT_SHA}" \
                            >> build-artifacts/build-info.txt

                        echo "Release Tag: ${RELEASE_TAG}" \
                            >> build-artifacts/build-info.txt
                    """

                    archiveArtifacts(
                        artifacts: 'build-artifacts/build-info.txt',
                        fingerprint: true
                    )
                }
            }
        }

        stage('TEST') {
            steps {
                script {
                    sh '''
                        rm -rf backend/test-results
                        rm -rf backend/coverage

                        mkdir -p backend/test-results
                    '''

                    sh '''
                        docker rm -f atelier-test-mongodb \
                            >/dev/null 2>&1 || true
                    '''

                    sh '''
                        docker run -d \
                            --name atelier-test-mongodb \
                            --network atelier-ci-network \
                            mongo:7
                    '''

                    sh '''
                        echo "Waiting for MongoDB..."

                        for i in $(seq 1 30); do
                            if docker exec atelier-test-mongodb \
                                mongosh --quiet \
                                --eval "db.adminCommand('ping').ok" \
                                2>/dev/null | grep -q "1"
                            then
                                echo "MongoDB is ready."
                                exit 0
                            fi

                            sleep 2
                        done

                        echo "MongoDB failed to become ready."
                        exit 1
                    '''

                    sh '''
                        npm ci
                    '''

                    sh '''
                        TEST_MONGODB_URI="mongodb://atelier-test-mongodb:27017/atelier-motors-test" \
                        npm run test:junit -w backend
                    '''

                    sh '''
                        TEST_MONGODB_URI="mongodb://atelier-test-mongodb:27017/atelier-motors-test" \
                        npm run test:coverage -w backend
                    '''

                    sh '''
                        TEST_MONGODB_URI="mongodb://atelier-test-mongodb:27017/atelier-motors-test" \
                        npm run test:coverage:check -w backend
                    '''
                }
            }

            post {
                always {
                    junit(
                        testResults: 'backend/test-results/junit.xml',
                        allowEmptyResults: false
                    )

                    publishHTML(
                        target: [
                            allowMissing: false,
                            alwaysLinkToLastBuild: true,
                            keepAll: true,
                            reportDir: 'backend/coverage',
                            reportFiles: 'index.html',
                            reportName: 'Backend Coverage Report',
                            reportTitles: 'Atelier Motors Backend Coverage'
                        ]
                    )
                }

                cleanup {
                    sh '''
                        docker rm -f atelier-test-mongodb \
                            >/dev/null 2>&1 || true
                    '''
                }
            }
        }

        stage('CODE QUALITY') {
            steps {
                script {
                    def scannerHome = tool 'SonarScanner'

                    withSonarQubeEnv('SonarQube') {
                        sh """
                            ${scannerHome}/bin/sonar-scanner
                        """
                    }

                    timeout(
                        time: 10,
                        unit: 'MINUTES'
                    ) {
                        waitForQualityGate(
                            abortPipeline: true
                        )
                    }
                }
            }
        }

        stage('SECURITY') {
            steps {
                script {
                    echo "========================================"
                    echo "Security Scanning"
                    echo "========================================"

                    echo "Running npm audit..."

                    sh '''
                        npm audit --audit-level=high
                    '''

                    echo "Running Trivy backend image scan..."

                    sh """
                        trivy image \
                            --scanners vuln \
                            --severity HIGH,CRITICAL \
                            --exit-code 1 \
                            --format table \
                            ${BACKEND_IMAGE}:${VERSION_TAG}
                    """

                    echo "Running Trivy frontend image scan..."

                    sh """
                        trivy image \
                            --scanners vuln \
                            --severity HIGH,CRITICAL \
                            --exit-code 1 \
                            --format table \
                            ${FRONTEND_IMAGE}:${VERSION_TAG}
                    """

                    echo "========================================"
                    echo "Security scans completed successfully."
                    echo "No HIGH or CRITICAL vulnerabilities detected."
                    echo "========================================"
                }
            }
        }

        stage('DEPLOY') {
            steps {
                script {
                    echo "========================================"
                    echo "STAGING DEPLOYMENT"
                    echo "========================================"

                    sh '''
                        docker network inspect atelier-ci-network \
                            >/dev/null 2>&1 || \
                        docker network create atelier-ci-network
                    '''

                    env.PREVIOUS_BACKEND_IMAGE = sh(
                        script: '''
                            docker inspect \
                                --format='{{.Config.Image}}' \
                                atelier-staging-backend \
                                2>/dev/null || true
                        ''',
                        returnStdout: true
                    ).trim()

                    env.PREVIOUS_FRONTEND_IMAGE = sh(
                        script: '''
                            docker inspect \
                                --format='{{.Config.Image}}' \
                                atelier-staging-frontend \
                                2>/dev/null || true
                        ''',
                        returnStdout: true
                    ).trim()

                    echo "Previous backend image: ${env.PREVIOUS_BACKEND_IMAGE ?: 'none'}"
                    echo "Previous frontend image: ${env.PREVIOUS_FRONTEND_IMAGE ?: 'none'}"

                    if (env.PREVIOUS_BACKEND_IMAGE?.trim()) {
                        env.PREVIOUS_BACKEND_TAG = sh(
                            script: """
                                echo '${env.PREVIOUS_BACKEND_IMAGE}' | \
                                awk -F: '{print \$NF}'
                            """,
                            returnStdout: true
                        ).trim()
                    }

                    if (env.PREVIOUS_FRONTEND_IMAGE?.trim()) {
                        env.PREVIOUS_FRONTEND_TAG = sh(
                            script: """
                                echo '${env.PREVIOUS_FRONTEND_IMAGE}' | \
                                awk -F: '{print \$NF}'
                            """,
                            returnStdout: true
                        ).trim()
                    }

                    echo "Previous backend tag: ${env.PREVIOUS_BACKEND_TAG ?: 'none'}"
                    echo "Previous frontend tag: ${env.PREVIOUS_FRONTEND_TAG ?: 'none'}"

                    withCredentials([
                        string(
                            credentialsId: 'jwt-secret',
                            variable: 'STAGING_JWT_SECRET'
                        )
                    ]) {

                        withEnv([
                            "BACKEND_IMAGE=${env.BACKEND_IMAGE}",
                            "FRONTEND_IMAGE=${env.FRONTEND_IMAGE}",
                            "IMAGE_TAG=${env.VERSION_TAG}",
                            "APP_VERSION=${env.VERSION_TAG}"
                        ]) {

                            echo "Deploying version ${env.VERSION_TAG}..."

                            sh '''
                                docker compose \
                                    -p atelier-staging \
                                    -f docker-compose.staging.yml \
                                    down \
                                    --remove-orphans \
                                    || true
                            '''

                            sh '''
                                docker compose \
                                    -p atelier-staging \
                                    -f docker-compose.staging.yml \
                                    up -d mongodb
                            '''

                            sh '''
                                echo "Waiting for staging MongoDB..."

                                for i in $(seq 1 30); do
                                    if docker exec atelier-staging-mongodb \
                                        mongosh --quiet \
                                        --eval "db.adminCommand('ping').ok" \
                                        2>/dev/null | grep -q "1"
                                    then
                                        echo "Staging MongoDB is ready."
                                        exit 0
                                    fi

                                    sleep 2
                                done

                                echo "Staging MongoDB failed to become ready."
                                exit 1
                            '''

                            sh '''
                                docker compose \
                                    -p atelier-staging \
                                    -f docker-compose.staging.yml \
                                    up -d backend
                            '''

                            sh '''
                                docker compose \
                                    -p atelier-staging \
                                    -f docker-compose.staging.yml \
                                    up -d frontend
                            '''

                            sh '''
                                echo "Checking staging backend..."

                                for i in $(seq 1 30); do

                                    if curl -fsS \
                                        http://atelier-staging-backend:5000/api/health \
                                        > /tmp/staging-health.json
                                    then

                                        echo "Backend response:"
                                        cat /tmp/staging-health.json

                                        STATUS=$(jq -r '.status' /tmp/staging-health.json)
                                        VERSION=$(jq -r '.version' /tmp/staging-health.json)

                                        echo "Detected status : ${STATUS}"
                                        echo "Detected version: ${VERSION}"
                                        echo "Expected version: ${APP_VERSION}"

                                        if [ "${STATUS}" = "ok" ] && \
                                           [ "${VERSION}" = "${APP_VERSION}" ]
                                        then
                                            echo "Staging backend health and version are correct."
                                            exit 0
                                        fi
                                    fi

                                    sleep 2
                                done

                                echo "Staging backend health/version check FAILED."
                                exit 1
                            '''

                            sh '''
                                echo "Checking staging frontend..."

                                for i in $(seq 1 30); do

                                    if curl -fsS \
                                        http://atelier-staging-frontend:8080/health \
                                        >/dev/null 2>&1
                                    then
                                        echo "Staging frontend is healthy."
                                        exit 0
                                    fi

                                    sleep 2
                                done

                                echo "Staging frontend health check FAILED."
                                exit 1
                            '''

                            sh '''
                                echo "Checking staging frontend on port 3001..."

                                for i in $(seq 1 30); do

                                    if curl -fsS \
                                        http://host.docker.internal:3001/health \
                                        >/dev/null 2>&1
                                    then
                                        echo "Staging frontend port 3001 is reachable."
                                        exit 0
                                    fi

                                    sleep 2
                                done

                                echo "Staging frontend port 3001 check FAILED."
                                exit 1
                            '''

                            echo "========================================"
                            echo "STAGING DEPLOYMENT SUCCESSFUL"
                            echo "========================================"
                            echo "Version : ${env.VERSION_TAG}"
                            echo "Git SHA : ${env.GIT_SHA}"
                            echo "Frontend: http://localhost:3001"
                            echo "Backend : http://localhost:5001"
                            echo "========================================"
                        }
                    }
                }
            }

            post {
                failure {
                    script {
                        echo "========================================"
                        echo "STAGING DEPLOYMENT FAILED"
                        echo "========================================"
                        echo "Starting automatic rollback..."
                        echo "========================================"

                        if (
                            env.PREVIOUS_BACKEND_TAG?.trim() &&
                            env.PREVIOUS_FRONTEND_TAG?.trim()
                        ) {

                            withCredentials([
                                string(
                                    credentialsId: 'jwt-secret',
                                    variable: 'STAGING_JWT_SECRET'
                                )
                            ]) {

                                sh '''
                                    docker compose \
                                        -p atelier-staging \
                                        -f docker-compose.staging.yml \
                                        down \
                                        --remove-orphans \
                                        || true
                                '''

                                withEnv([
                                    "BACKEND_IMAGE=${env.BACKEND_IMAGE}",
                                    "FRONTEND_IMAGE=${env.FRONTEND_IMAGE}",
                                    "IMAGE_TAG=${env.PREVIOUS_BACKEND_TAG}",
                                    "APP_VERSION=${env.PREVIOUS_BACKEND_TAG}"
                                ]) {

                                    sh '''
                                        docker compose \
                                            -p atelier-staging \
                                            -f docker-compose.staging.yml \
                                            up -d mongodb
                                    '''

                                    sh '''
                                        echo "Waiting for rollback MongoDB..."

                                        for i in $(seq 1 30); do
                                            if docker exec atelier-staging-mongodb \
                                                mongosh --quiet \
                                                --eval "db.adminCommand('ping').ok" \
                                                2>/dev/null | grep -q "1"
                                            then
                                                echo "Rollback MongoDB is ready."
                                                exit 0
                                            fi

                                            sleep 2
                                        done

                                        echo "Rollback MongoDB failed."
                                        exit 1
                                    '''

                                    sh '''
                                        docker compose \
                                            -p atelier-staging \
                                            -f docker-compose.staging.yml \
                                            up -d backend
                                    '''
                                }

                                withEnv([
                                    "BACKEND_IMAGE=${env.BACKEND_IMAGE}",
                                    "FRONTEND_IMAGE=${env.FRONTEND_IMAGE}",
                                    "IMAGE_TAG=${env.PREVIOUS_FRONTEND_TAG}",
                                    "APP_VERSION=${env.PREVIOUS_BACKEND_TAG}"
                                ]) {

                                    sh '''
                                        docker compose \
                                            -p atelier-staging \
                                            -f docker-compose.staging.yml \
                                            up -d frontend
                                    '''
                                }

                                sh '''
                                    echo "Checking rollback backend..."

                                    for i in $(seq 1 30); do

                                        if curl -fsS \
                                            http://atelier-staging-backend:5000/api/health \
                                            > /tmp/rollback-health.json
                                        then

                                            STATUS=$(jq -r '.status' /tmp/rollback-health.json)

                                            if [ "${STATUS}" = "ok" ]
                                            then
                                                echo "Rollback backend is healthy."
                                                exit 0
                                            fi
                                        fi

                                        sleep 2
                                    done

                                    echo "Rollback backend health check FAILED."
                                    exit 1
                                '''

                                sh '''
                                    echo "Checking rollback frontend..."

                                    for i in $(seq 1 30); do

                                        if curl -fsS \
                                            http://atelier-staging-frontend:8080/health \
                                            >/dev/null 2>&1
                                        then
                                            echo "Rollback frontend is healthy."
                                            exit 0
                                        fi

                                        sleep 2
                                    done

                                    echo "Rollback frontend health check FAILED."
                                    exit 1
                                '''

                                echo "========================================"
                                echo "ROLLBACK COMPLETED"
                                echo "========================================"
                                echo "Backend restored : ${env.PREVIOUS_BACKEND_TAG}"
                                echo "Frontend restored: ${env.PREVIOUS_FRONTEND_TAG}"
                                echo "========================================"
                            }

                        } else {

                            echo "No previous staging deployment was found."
                            echo "There is nothing available to roll back to."

                            sh '''
                                docker compose \
                                    -p atelier-staging \
                                    -f docker-compose.staging.yml \
                                    down \
                                    --remove-orphans \
                                    || true
                            '''
                        }
                    }
                }
            }
        }

        stage('RELEASE') {
            steps {
                script {

                    echo "========================================"
                    echo "RELEASE"
                    echo "========================================"

                    echo "Docker Hub namespace: ${env.DOCKERHUB_NAMESPACE}"
                    echo "Version tag         : ${env.VERSION_TAG}"
                    echo "SHA tag             : ${env.SHA_TAG}"
                    echo "Git release tag     : ${env.RELEASE_TAG}"

                    withCredentials([
                        usernamePassword(
                            credentialsId: 'dockerhub-creds',
                            usernameVariable: 'DOCKERHUB_USERNAME',
                            passwordVariable: 'DOCKERHUB_TOKEN'
                        )
                    ]) {

                        sh '''
                            echo "Logging in to Docker Hub..."

                            set +x

                            echo "$DOCKERHUB_TOKEN" | \
                                docker login \
                                    --username "$DOCKERHUB_USERNAME" \
                                    --password-stdin

                            set -x
                        '''

                        sh """
                            docker tag \
                                ${BACKEND_IMAGE}:${VERSION_TAG} \
                                ${DOCKERHUB_NAMESPACE}/${BACKEND_IMAGE}:${VERSION_TAG}

                            docker tag \
                                ${BACKEND_IMAGE}:${SHA_TAG} \
                                ${DOCKERHUB_NAMESPACE}/${BACKEND_IMAGE}:${SHA_TAG}

                            docker tag \
                                ${FRONTEND_IMAGE}:${VERSION_TAG} \
                                ${DOCKERHUB_NAMESPACE}/${FRONTEND_IMAGE}:${VERSION_TAG}

                            docker tag \
                                ${FRONTEND_IMAGE}:${SHA_TAG} \
                                ${DOCKERHUB_NAMESPACE}/${FRONTEND_IMAGE}:${SHA_TAG}
                        """

                        sh """
                            docker push \
                                ${DOCKERHUB_NAMESPACE}/${BACKEND_IMAGE}:${VERSION_TAG}

                            docker push \
                                ${DOCKERHUB_NAMESPACE}/${BACKEND_IMAGE}:${SHA_TAG}

                            docker push \
                                ${DOCKERHUB_NAMESPACE}/${FRONTEND_IMAGE}:${VERSION_TAG}

                            docker push \
                                ${DOCKERHUB_NAMESPACE}/${FRONTEND_IMAGE}:${SHA_TAG}
                        """

                        sh '''
                            docker logout
                        '''
                    }

                    echo "Docker images successfully pushed to Docker Hub."

                    sh """
                        git config user.name "Jenkins"
                        git config user.email "jenkins@atelier-motors.local"

                        git tag -a "${RELEASE_TAG}" \
                            -m "Atelier Motors release ${VERSION_TAG}"
                    """

                    withCredentials([
                        gitUsernamePassword(
                            credentialsId: 'github-creds',
                            gitToolName: 'Default'
                        )
                    ]) {

                        sh """
                            git push origin \
                                "refs/tags/${RELEASE_TAG}"
                        """
                    }

                    echo "========================================"
                    echo "RELEASE ARTIFACTS PUBLISHED"
                    echo "========================================"
                    echo "Docker backend:"
                    echo "  ${DOCKERHUB_NAMESPACE}/${BACKEND_IMAGE}:${VERSION_TAG}"
                    echo "  ${DOCKERHUB_NAMESPACE}/${BACKEND_IMAGE}:${SHA_TAG}"
                    echo ""
                    echo "Docker frontend:"
                    echo "  ${DOCKERHUB_NAMESPACE}/${FRONTEND_IMAGE}:${VERSION_TAG}"
                    echo "  ${DOCKERHUB_NAMESPACE}/${FRONTEND_IMAGE}:${SHA_TAG}"
                    echo ""
                    echo "Git tag: ${RELEASE_TAG}"
                    echo "========================================"
                }
            }
        }

        stage('PRODUCTION APPROVAL') {
            steps {
                timeout(
                    time: 10,
                    unit: 'MINUTES'
                ) {
                    input(
                        message: "Promote Atelier Motors ${env.VERSION_TAG} to production?",
                        ok: "Deploy to Production"
                    )
                }
            }
        }

        stage('PRODUCTION') {
            steps {
                script {

                    echo "========================================"
                    echo "PRODUCTION DEPLOYMENT"
                    echo "========================================"

                    sh '''
                        docker network inspect atelier-ci-network \
                            >/dev/null 2>&1 || \
                        docker network create atelier-ci-network
                    '''

                    withCredentials([
                        string(
                            credentialsId: 'production-jwt-secret',
                            variable: 'PRODUCTION_JWT_SECRET'
                        )
                    ]) {

                        withEnv([
                            "BACKEND_IMAGE=${env.DOCKERHUB_NAMESPACE}/${env.BACKEND_IMAGE}",
                            "FRONTEND_IMAGE=${env.DOCKERHUB_NAMESPACE}/${env.FRONTEND_IMAGE}",
                            "IMAGE_TAG=${env.VERSION_TAG}",
                            "APP_VERSION=${env.VERSION_TAG}"
                        ]) {

                            echo "Deploying exact released images..."
                            echo "Version: ${env.VERSION_TAG}"

                            sh '''
                                docker compose \
                                    -p atelier-production \
                                    -f docker-compose.production.yml \
                                    down \
                                    --remove-orphans \
                                    || true
                            '''

                            sh '''
                                docker compose \
                                    -p atelier-production \
                                    -f docker-compose.production.yml \
                                    pull
                            '''

                            sh '''
                                docker compose \
                                    -p atelier-production \
                                    -f docker-compose.production.yml \
                                    up -d
                            '''

                            sh '''
                                echo "Waiting for production backend..."

                                for i in $(seq 1 30); do

                                    if curl -fsS \
                                        http://atelier-production-backend:5000/api/health \
                                        > /tmp/production-health.json
                                    then

                                        echo "Production backend response:"
                                        cat /tmp/production-health.json

                                        STATUS=$(jq -r '.status' /tmp/production-health.json)
                                        VERSION=$(jq -r '.version' /tmp/production-health.json)

                                        echo "Detected status : ${STATUS}"
                                        echo "Detected version: ${VERSION}"
                                        echo "Expected version: ${APP_VERSION}"

                                        if [ "${STATUS}" = "ok" ] && \
                                           [ "${VERSION}" = "${APP_VERSION}" ]
                                        then
                                            echo "Production backend health and version are correct."
                                            exit 0
                                        fi
                                    fi

                                    sleep 2
                                done

                                echo "Production backend health/version check FAILED."
                                exit 1
                            '''

                            sh '''
                                echo "Checking production frontend..."

                                for i in $(seq 1 30); do

                                    if curl -fsS \
                                        http://atelier-production-frontend:8080/health \
                                        >/dev/null 2>&1
                                    then
                                        echo "Production frontend is healthy."
                                        exit 0
                                    fi

                                    sleep 2
                                done

                                echo "Production frontend health check FAILED."
                                exit 1
                            '''

                            sh '''
                                echo "Checking production frontend on port 3000..."

                                for i in $(seq 1 30); do

                                    if curl -fsS \
                                        http://host.docker.internal:3000/health \
                                        >/dev/null 2>&1
                                    then
                                        echo "Production frontend port 3000 is reachable."
                                        exit 0
                                    fi

                                    sleep 2
                                done

                                echo "Production frontend port 3000 check FAILED."
                                exit 1
                            '''

                            echo "========================================"
                            echo "PRODUCTION DEPLOYMENT SUCCESSFUL"
                            echo "========================================"
                            echo "Version : ${env.VERSION_TAG}"
                            echo "Git SHA : ${env.GIT_SHA}"
                            echo "Frontend: http://localhost:3000"
                            echo "Backend : http://localhost:5002"
                            echo "========================================"
                        }
                    }
                }
            }
        }
    }

    post {

        success {
            echo "========================================"
            echo "PIPELINE SUCCESS"
            echo "========================================"

            echo """
            Build ${env.BUILD_NUMBER} completed successfully.

            Version : ${env.VERSION_TAG}
            Git SHA : ${env.GIT_SHA}
            Release : ${env.RELEASE_TAG}
            """

            echo "Production: http://localhost:3000"
        }

        failure {
            echo "========================================"
            echo "PIPELINE FAILED"
            echo "========================================"

            echo "Check the failed stage in Jenkins."
        }

        always {
            echo "Jenkins build ${env.BUILD_NUMBER} finished."

            cleanWs(
                deleteDirs: true,
                notFailBuild: true
            )
        }
    }
}