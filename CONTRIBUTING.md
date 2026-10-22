# Contributing to PixelMesh

Thank you for your interest in contributing to **PixelMesh**! We welcome contributions from developers, researchers, and AI agent architects.

This document provides guidelines and instructions for contributing to the PixelMesh codebase and documentation.

---

## 🧭 Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Prerequisites](#prerequisites)
- [Local Development Setup](#local-development-setup)
- [Project Architecture](#project-architecture)
- [Testing & Quality Gates](#testing--quality-gates)
- [Branching & Commit Conventions](#branching--commit-conventions)
- [Submitting a Pull Request](#submitting-a-pull-request)

---

## 📜 Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free environment for everyone. Please be respectful, constructive, and collaborative in all issues, pull requests, and discussions.

---

## 🛠️ Prerequisites

Before you begin, ensure you have the following installed locally:
- **Node.js**: Version 18.0 or later (Node 20+ recommended)
- **Package Manager**: `npm` (comes with Node) or `pnpm`
- **Git**: Configured with your committer identity

---

## 💻 Local Development Setup

1. **Fork and Clone the Repository**:
   ```bash
   git clone https://github.com/RohitWaghire/PixelMesh.git
   cd PixelMesh
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Environment Setup**:
   Create a `.env` file based on `.env.example` if available, or configure the required environment variables:
   ```env
   NODE_ENV=development
   GITHUB_WEBHOOK_SECRET=your_development_secret_here
   ```

4. **Start the Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to view the Web Studio & Dashboard.

---

## 📐 Project Architecture

PixelMesh is structured as a dual-audience visual studio and agent tool mesh:
- `app/`: Next.js 15 App Router routes (`/studio`, `/dashboard`, `/docs`, `/api/mcp`, `/api/webhooks/github`).
- `components/`: React 19 UI components (`components/studio`, `components/dashboard`, `components/landing`).
- `lib/image/`: Sharp (libvips) C++ native image processing pipeline and filters.
- `lib/auth/`: Ed25519/RSA-2048 asymmetric request signing and anti-replay nonce cache.
- `lib/webmcp/`: W3C WebMCP draft specification implementation (`document.modelContext`).
- `lib/webhooks/`: Inbound GitHub App webhook gateway, constant-time HMAC verification, and idempotency store.
- `docs/adr/`: Architectural Decision Records documenting system invariants.

---

## 🧪 Testing & Quality Gates

All contributions must pass automated tests and static analysis before being merged:

1. **Run Unit & Integration Tests**:
   ```bash
   npm test
   ```
2. **Type Checking**:
   ```bash
   npm run typecheck
   ```
3. **Linting**:
   ```bash
   npm run lint
   ```

---

## 🌿 Branching & Commit Conventions

- **Active Development**: Active work occurs on feature branches branched from `dev`.
- **Commit Messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat(scope): add new capability`
  - `fix(scope): resolve bug or defect`
  - `docs(scope): update or add documentation`
  - `test(scope): add or improve test coverage`
  - `refactor(scope): internal structural improvements`

---

## 🚀 Submitting a Pull Request

1. Ensure all tests, typechecks, and linter checks pass locally.
2. Push your changes to your fork or branch on GitHub.
3. Open a Pull Request targeting the `main` or `dev` branch as appropriate.
4. Provide a clear summary of what was changed and reference any relevant issues.
5. Automated review tools (such as Greptile and CI checks) will run on your PR. Address any review findings constructively.
