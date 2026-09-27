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
                        docker rm -f atelier-test-mongodb >/dev/null 2>&1 || true
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
                        docker rm -f atelier-test-mongodb >/dev/null 2>&1 || true
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

                    timeout(time: 10, unit: 'MINUTES') {
                        waitForQualityGate abortPipeline: true
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
    }

    post {
        success {
            echo 'BUILD, TEST, CODE QUALITY and SECURITY stages completed successfully.'
        }

        failure {
            echo 'One or more pipeline stages failed.'
        }

        always {
            echo "Jenkins build ${env.BUILD_NUMBER} finished."
        }
    }
}