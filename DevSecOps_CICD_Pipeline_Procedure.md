# DevSecOps CI/CD Pipeline Integration & Deployment Procedure

**Document Type:** Standard Operating Procedure (SOP) / Technical Runbook
**Classification:** Internal — Engineering / DevOps
**Version:** 1.0
**Effective Date:** <DD-MMM-YYYY>
**Owner:** DevOps / Platform Engineering Team
**Review Cycle:** Semi-Annual / On Major Toolchain Change

---

## Document Control

| Version | Date | Author | Description | Approved By |
|---|---|---|---|---|
| 1.0 | <date> | <name> | Initial release | <name> |

---

## 1. Purpose

This document defines the standard, auditable procedure for building, securing, and deploying applications through the organization's DevSecOps toolchain — from developer commit on a local workstation to artifact promotion and deployment on target infrastructure. It formalizes the CI/CD pipeline as implemented via **GitLab CI/CD**, integrates security scanning ("Sec" in DevSecOps) as a mandatory gate rather than an afterthought, and establishes **JFrog Artifactory** as the single source of truth for build artifact storage and versioning.

## 2. Scope

This procedure applies to all application code (Java/Spring Boot services, static frontend builds, and other in-scope workloads) deployed to target runtime environments (e.g., WebLogic, Tomcat, Nginx, Kubernetes) within the organization's environment. It covers the full lifecycle: local development → source control → automated pipeline execution → security scanning → build → artifact publishing → deployment → post-deployment verification.

**Out of scope:** infrastructure provisioning (IaC), network/firewall configuration, and end-user application functional testing (covered by separate SOPs).

## 3. Definitions & Acronyms

| Term | Definition |
|---|---|
| CI/CD | Continuous Integration / Continuous Delivery (or Deployment) |
| SAST | Static Application Security Testing |
| SCA | Software Composition Analysis (dependency/OSS vulnerability scanning) |
| DAST | Dynamic Application Security Testing (optional, post-deploy) |
| Artifact | The immutable, versioned build output (WAR/JAR/tarball/Docker image) |
| Runner | GitLab CI/CD execution agent that runs pipeline jobs |
| Promotion | Movement of an artifact between repositories representing lifecycle stage (e.g., dev → staging → release) |
| Maker-Checker | Segregation-of-duties control requiring a second approver before a sensitive action executes |

## 4. Roles & Responsibilities

| Role | Responsibility |
|---|---|
| **Developer** | Writes code locally, runs pre-commit checks, pushes to GitLab feature branch, raises Merge Request (MR) |
| **Reviewer / Approver** | Reviews MR (code quality, security findings, test coverage) before merge |
| **DevOps/Platform Engineer** | Owns and maintains `.gitlab-ci.yml`, runner infrastructure, JFrog repo configuration, deployment scripts |
| **Security/AppSec Team** | Defines scan policy, vulnerability severity thresholds, and break-the-build rules |
| **Release/Change Manager** | Approves production deployment window; maintains change record |
| **GitLab Runner (automated)** | Executes pipeline stages per `.gitlab-ci.yml` |

## 5. Toolchain Overview

| Layer | Tool | Purpose |
|---|---|---|
| Source Control | GitLab (self-hosted) | Version control, Merge Requests, branch protection |
| CI/CD Orchestration | GitLab CI/CD + GitLab Runner | Pipeline execution engine |
| SAST | <e.g., SonarQube / Checkmarx / Semgrep> | Static code security & quality scanning |
| SCA | <e.g., JFrog Xray / OWASP Dependency-Check / Snyk> | Open-source dependency vulnerability scanning |
| Build | <Maven / Gradle / npm / ng build> | Compiles source, resolves dependencies, produces build output |
| Artifact Repository | JFrog Artifactory | Immutable, versioned storage of build artifacts (WAR/JAR/tarball/Docker) |
| Deployment Target(s) | WebLogic 14.1.1.0.0 / Apache Tomcat / Nginx / Kubernetes | Application runtime environment(s) |
| Secrets Management | GitLab CI/CD Variables (masked/protected) / <Vault, if applicable> | Credential and secret injection at runtime |

## 6. High-Level Pipeline Flow

```
[Developer Local Workstation]
        |  git commit / git push (feature branch)
        v
[GitLab Repository]
        |  Merge Request raised --> peer review + branch protection gate
        v
[GitLab CI/CD Pipeline Triggered] (GitLab Runner picks up job)
        |
        |--> STAGE 1: Validate / Lint
        |--> STAGE 2: SAST (Static Code Scan)
        |--> STAGE 3: SCA (Dependency / License Scan)
        |--> STAGE 4: Build (compile, package)
        |--> STAGE 5: Publish Artifact --> JFrog Artifactory (versioned)
        |--> STAGE 6: Deploy --> Target Server/Environment
        |--> STAGE 7: Post-Deploy Verification (smoke test / health check)
        v
[Artifact retained in JFrog for traceability, rollback, and audit]
```

## 7. Detailed Stage-by-Stage Procedure

### 7.1 Stage 0 — Local Development
- Developer writes/modifies code on local desktop workstation.
- Developer runs local build and unit tests before pushing (`mvn clean verify`, `npm run build`, etc., as applicable).
- Developer commits with a descriptive message referencing the ticket/story ID and pushes to a feature branch — **direct pushes to `main`/`release` branches are disabled via branch protection rules.**

### 7.2 Stage 1 — Source Control & Pipeline Trigger
- Push to GitLab triggers the pipeline defined in `.gitlab-ci.yml` via the configured GitLab Runner(s).
- Merge Request workflow enforces: minimum reviewer approval, passing pipeline status, and no unresolved critical security findings before merge to protected branches.

### 7.3 Stage 2 — Static Application Security Testing (SAST)
- Source code is scanned for insecure coding patterns, hardcoded secrets, and OWASP Top-10 class vulnerabilities.
- **Gate:** Pipeline fails (or raises a blocking MR flag) on Critical/High severity findings, per organizational security policy.
- Scan reports are archived as pipeline artifacts for audit trail.

### 7.4 Stage 3 — Software Composition Analysis (SCA) / Dependency Check
- All third-party/open-source dependencies (Maven/npm/etc.) are scanned against known CVE databases.
- License compliance is validated against the approved license list.
- **Gate:** Build fails on dependencies with Critical/High CVEs lacking an approved exception/waiver.

### 7.5 Stage 4 — Build
- Application is compiled and packaged (e.g., WAR for WebLogic/Tomcat, static bundle for Nginx, container image for Kubernetes).
- Build metadata (commit SHA, pipeline ID, timestamp, branch) is injected into the artifact (e.g., via manifest/properties file) for full traceability.

### 7.6 Stage 5 — Artifact Publishing & Versioning (JFrog Artifactory)
- Successfully built artifact is uploaded to the designated JFrog Artifactory repository (e.g., `libs-release-local`, `generic-release-local`).
- **Versioning scheme:** `<app-name>-<semver or build-number>-<git-short-sha>.<ext>` (standardize per org convention — semantic versioning recommended: `MAJOR.MINOR.PATCH`).
- Artifact properties (build number, commit, pipeline URL, scan pass/fail status) are attached as Artifactory metadata for traceability and future audit.
- Retention/cleanup policy applied per repository (e.g., retain last N versions or per compliance retention requirement).

### 7.7 Stage 6 — Deployment to Target Server
- Deployment job pulls the specific versioned artifact from JFrog (never rebuilds from source at this stage — **build once, promote everywhere** principle).
- Deployment executes via the environment-appropriate method, e.g.:
  - **WebLogic:** WLST/WDT-based deployment of WAR to managed server/cluster.
  - **Tomcat:** Manager API or filesystem deployment with service restart.
  - **Nginx (static content):** Atomic symlink swap (`ln -sfn`) to new release directory; scoped `sudo systemctl reload nginx`.
  - **Kubernetes:** Image pull from registry and rolling update via manifest/Helm.
- Deployment credentials are injected via masked/protected GitLab CI/CD variables — never hardcoded in scripts.

### 7.8 Stage 7 — Post-Deployment Verification
- Automated smoke test / health-check endpoint validation.
- **Automatic rollback** to the previous known-good artifact version on smoke test failure, where configured.
- Deployment status and version notified to relevant channel (email/Slack/Teams webhook).

## 8. Security Controls Summary (DevSecOps Gates)

| Gate | Stage | Enforcement |
|---|---|---|
| Branch protection & MR approval | Pre-pipeline | GitLab project settings |
| SAST scan pass | Stage 2 | Pipeline job exit code / quality gate |
| SCA / CVE scan pass | Stage 3 | Pipeline job exit code / quality gate |
| Secrets/credential scanning | Stage 1–2 | Pre-commit hook + pipeline scan |
| Artifact integrity | Stage 5 | Artifactory checksum (SHA256) verification |
| Segregation of duties | Deployment (Prod) | Maker-checker approval for production deploy jobs |
| Filesystem hardening (target) | Runtime | e.g., `nosuid`/`noexec` mount options, least-privilege service accounts |

## 9. Rollback & Recovery Procedure

1. Identify last known-good artifact version from JFrog Artifactory (via build metadata/tags).
2. Trigger rollback job (manual or automatic) pointing to that specific artifact version.
3. Re-deploy using the same Stage 6 deployment mechanism.
4. Verify via Stage 7 health checks.
5. Log rollback event with reason code in the change record.

## 10. Traceability & Audit Trail

Every artifact deployed to any environment must be traceable end-to-end via:
- Git commit SHA → Pipeline ID → Artifactory build metadata → Deployment log entry.
- This chain must be reproducible on demand for internal/external audit and compliance review.

## 11. Environment Matrix (fill in per application)

| Environment | Branch | JFrog Repo | Deployment Target | Approval Required |
|---|---|---|---|---|
| Dev | `develop` | `*-dev-local` | Dev server | No |
| QA/Staging | `release/*` | `*-staging-local` | Staging server | Peer |
| Production | `main`/`master` | `*-release-local` | Prod server(s) | Change Manager + Maker-Checker |

## 12. Appendix A — Reference `.gitlab-ci.yml` Skeleton

```yaml
stages:
  - validate
  - sast
  - sca
  - build
  - publish
  - deploy
  - verify

variables:
  ARTIFACT_VERSION: "${CI_COMMIT_REF_SLUG}-${CI_PIPELINE_ID}"

validate:
  stage: validate
  script:
    - echo "Lint / static checks"

sast_scan:
  stage: sast
  script:
    - echo "Run SAST tool, fail on Critical/High"
  artifacts:
    paths: [sast-report.json]

sca_scan:
  stage: sca
  script:
    - echo "Run SCA/dependency scan, fail on Critical/High CVE"
  artifacts:
    paths: [sca-report.json]

build:
  stage: build
  script:
    - echo "Compile & package artifact"
  artifacts:
    paths: [target/*.war]

publish_artifact:
  stage: publish
  script:
    - echo "Upload to JFrog Artifactory with version ${ARTIFACT_VERSION}"

deploy:
  stage: deploy
  script:
    - echo "Pull versioned artifact from JFrog and deploy to target"
  environment:
    name: production
  when: manual
  only:
    - main

post_deploy_verify:
  stage: verify
  script:
    - echo "Run smoke test / health check; rollback on failure"
```

## 13. Appendix B — Change/Review Log

| Change # | Description | Requested By | Date |
|---|---|---|---|
| | | | |

---
*This document is a controlled template. Update repository names, tool selections, versioning scheme, and approval matrix to match the specific application before use in an audit context.*
