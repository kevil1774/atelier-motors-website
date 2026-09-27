pipeline {
    agent any

    options {
        timestamps()

        timeout(
            time: 30,
            unit: 'MINUTES'
        )

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

        TEST_MONGODB_URI = 'mongodb://atelier-test-mongodb:27017/atelier-motors-test'
    }

    stages {

        /*
         * ============================================================
         * BUILD
         * ============================================================
         */

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

                    echo "========================================"
                    echo "Atelier Motors Build"
                    echo "========================================"
                    echo "Application : ${env.APP_NAME}"
                    echo "Version     : ${env.APP_VERSION}"
                    echo "Git SHA     : ${env.GIT_SHA}"
                    echo "Version tag : ${env.VERSION_TAG}"
                    echo "SHA tag     : ${env.SHA_TAG}"
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
                    """

                    archiveArtifacts(
                        artifacts: 'build-artifacts/build-info.txt',
                        fingerprint: true
                    )
                }
            }
        }


        /*
         * ============================================================
         * TEST
         * ============================================================
         */

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


        /*
         * ============================================================
         * CODE QUALITY
         * ============================================================
         */

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


        /*
         * ============================================================
         * SECURITY
         * ============================================================
         */

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


        /*
         * ============================================================
         * DEPLOY
         *
         * Staging:
         *   Frontend -> localhost:3001
         *   Backend  -> localhost:5001
         *
         * Uses docker-compose.staging.yml.
         * Automatically rolls back to the previous images if
         * staging health/version validation fails.
         * ============================================================
         */

        stage('DEPLOY') {
            steps {
                script {

                    echo "========================================"
                    echo "STAGING DEPLOYMENT"
                    echo "========================================"

                    /*
                     * Make sure the shared CI network exists.
                     */
                    sh '''
                        docker network inspect atelier-ci-network \
                            >/dev/null 2>&1 || \
                        docker network create atelier-ci-network
                    '''

                    /*
                     * Capture currently deployed images before
                     * replacing the staging deployment.
                     */
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

                    /*
                     * Extract previous version tags.
                     *
                     * Example:
                     * atelier-motors-backend:1.0.10
                     * becomes:
                     * 1.0.10
                     */
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


                    /*
                     * Deploy current build.
                     */
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

                            /*
                             * Remove the previous Compose deployment.
                             */
                            sh '''
                                docker compose \
                                    -p atelier-staging \
                                    -f docker-compose.staging.yml \
                                    down \
                                    --remove-orphans \
                                    || true
                            '''

                            /*
                             * Start MongoDB first.
                             */
                            sh '''
                                docker compose \
                                    -p atelier-staging \
                                    -f docker-compose.staging.yml \
                                    up -d mongodb
                            '''

                            /*
                             * Wait for staging MongoDB.
                             */
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

                            /*
                             * Start backend.
                             */
                            sh '''
                                docker compose \
                                    -p atelier-staging \
                                    -f docker-compose.staging.yml \
                                    up -d backend
                            '''

                            /*
                             * Start frontend.
                             */
                            sh '''
                                docker compose \
                                    -p atelier-staging \
                                    -f docker-compose.staging.yml \
                                    up -d frontend
                            '''

                            /*
                             * Check backend health AND version.
                             */
                            sh '''
                                echo "Checking staging backend..."

                                for i in $(seq 1 30); do

                                    if curl -fsS \
                                        http://atelier-staging-backend:5000/api/health \
                                        > /tmp/staging-health.json
                                    then

                                        echo "Backend response:"
                                        cat /tmp/staging-health.json

                                        if grep -q "\"status\":\"ok\"" \
                                            /tmp/staging-health.json && \
                                           grep -q "\"version\":\"$APP_VERSION\"" \
                                            /tmp/staging-health.json
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

                            /*
                             * Check frontend health.
                             */
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

                            /*
                             * Check the public staging frontend endpoint.
                             */
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

            /*
             * ========================================================
             * AUTOMATIC ROLLBACK
             * ========================================================
             */

            post {
                failure {
                    script {

                        echo "========================================"
                        echo "STAGING DEPLOYMENT FAILED"
                        echo "========================================"
                        echo "Starting automatic rollback..."
                        echo "========================================"

                        /*
                         * Rollback only when a previous deployment
                         * actually exists.
                         */
                        if (
                            env.PREVIOUS_BACKEND_TAG?.trim() &&
                            env.PREVIOUS_FRONTEND_TAG?.trim()
                        ) {

                            echo "Previous backend tag : ${env.PREVIOUS_BACKEND_TAG}"
                            echo "Previous frontend tag: ${env.PREVIOUS_FRONTEND_TAG}"

                            withCredentials([
                                string(
                                    credentialsId: 'jwt-secret',
                                    variable: 'STAGING_JWT_SECRET'
                                )
                            ]) {

                                /*
                                 * Remove failed deployment.
                                 */
                                sh '''
                                    docker compose \
                                        -p atelier-staging \
                                        -f docker-compose.staging.yml \
                                        down \
                                        --remove-orphans \
                                        || true
                                '''

                                /*
                                 * Restore MongoDB.
                                 */
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

                                    /*
                                     * Restore previous backend.
                                     */
                                    sh '''
                                        docker compose \
                                            -p atelier-staging \
                                            -f docker-compose.staging.yml \
                                            up -d backend
                                    '''
                                }

                                /*
                                 * Restore previous frontend using
                                 * its own previous tag.
                                 */
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

                                /*
                                 * Verify rollback backend.
                                 */
                                sh '''
                                    echo "Checking rollback backend..."

                                    for i in $(seq 1 30); do

                                        if curl -fsS \
                                            http://atelier-staging-backend:5000/api/health \
                                            > /tmp/rollback-health.json
                                        then

                                            echo "Rollback backend response:"
                                            cat /tmp/rollback-health.json

                                            if grep -q "\"status\":\"ok\"" \
                                                /tmp/rollback-health.json
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

                                /*
                                 * Verify rollback frontend.
                                 */
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
    }

    /*
     * ================================================================
     * PIPELINE POST ACTIONS
     * ================================================================
     */

    post {

        success {
            echo "========================================"
            echo "PIPELINE SUCCESS"
            echo "========================================"

            echo """
            Build ${env.BUILD_NUMBER} completed successfully.

            Version : ${env.VERSION_TAG}
            Git SHA : ${env.GIT_SHA}
            """
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