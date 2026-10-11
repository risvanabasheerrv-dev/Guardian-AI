# ⚡ Guardian AI

> **Autonomous AI Security Orchestrator for GitLab Merge Requests**

**🚀 Live Instance (Try it!):** [https://api-urtl66e5lq-uc.a.run.app/](https://api-urtl66e5lq-uc.a.run.app/)  
**📹 Demo Video:** [Watch on YouTube](https://youtu.be/YQyuyM2b5IA)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![Groq Llama 3.3](https://img.shields.io/badge/Groq-Llama--3.3--70B-orange.svg)](https://groq.com)
[![Cloud Run](https://img.shields.io/badge/Google%20Cloud-Cloud%20Run-blue.svg)](https://cloud.google.com/run)

---

## 🏗️ The Problem: The Human BottleNeck

When a developer opens a Merge Request on GitLab, it enters a bottleneck. A human checks security. Another checks documentation. Another checks standards. Teams at high velocity lose **2-3 days per MR** waiting for sequential human reviews.

## 🚀 The Solution: Guardian AI

Guardian AI is a **webhook-triggered, multi-agent orchestration system** that autonomously handles the entire MR review lifecycle the moment code is pushed. Not a chatbot. Not a code generator. **An autonomous system that takes action.**

```
GitLab MR Opened
       │
       ▼
  POST /webhook
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│                   GUARDIAN AI ORCHESTRATOR                 │
│                                                          │
│  [1] Context Engine ──RAG──▶ VectorStore                 │
│       ↓                                                  │
│  [2] Security Auditor ──Groq+Gemini+OSV──▶ Consensus     │
│       ↓                                                  │
│  [3] Docs Guardian ──Gemini──▶ Wiki Auto-Update          │
│       ↓                                                  │
│  [4] Risk Scorer ──Weighted Matrix──▶ Score 0-100        │
│       ↓                                                  │
│  [5] Green Sentinel ──CO₂ Math──▶ Green Metrics          │
│       ↓                                                  │
│  [6] Action Agent ──GitLab API──▶ Comments+Labels+Email  │
└──────────────────────────────────────────────────────────┘
       │
       ▼
  MR Has: Dashboard Comment + One-Click Fix Suggestions
          + Updated Wiki + Label Applied + Email Brief
```

## 🤖 The 6 Agents (The Swarm)

| Agent | Role | Key Action |
|-------|------|------------|
| 🧠 **Context Engine** | RAG system | Embeds MR diff, wiki, issues into vector store using **Cosine Similarity**. |
| 🔐 **Security Auditor** | **Dual-AI Consensus** | Teams up **Groq (Llama 3.3 70B)** & **Gemini 2.0 Flash** to independently audit code. Only vulnerabilities agreed upon by both (Consensus) are flagged to eliminate hallucinations! |
| 📚 **Docs Guardian** | Documentation health | Auto-updates GitLab Wiki when code changes break existing docs. |
| 📊 **Risk Scorer** | Risk quantification | Weighted 0-100 score based on audit severity. |
| 🌱 **Green Sentinel** | Environmental impact | Tracks compute energy + CO₂ savings per scan. |
| ⚡ **Action Agent** | Execution layer | Posts comments, labels, provides one-click fixes, and emails Executive Briefs. |


- ✅ **GitLab AI Orchestration** — Built with a multi-agent swarm that makes autonomous logic decisions.
- ✅ **Groq Llama 3.3 Integration** — Powered by ultra-fast Groq LPU inference for real-time security reasoning.
- ✅ **Google Cloud Multi-Cloud** — Deployed natively on Google Cloud Run with Firestore storage and local fallback.
- ✅ **Green Tech Bonus** — Green Sentinel agent actively quantifies energy reduction in the MR lifecycle.

## 🚀 How to Try It (Recommended)

Guardian AI is a fully deployed, multi-tenant SaaS application. **You do not need to install anything locally to test it.**

1. Visit the Live Dashboard: **[https://api-urtl66e5lq-uc.a.run.app/signup](https://api-urtl66e5lq-uc.a.run.app/signup)**
2. Create a tenant profile and follow the **Setup Wizard**.
3. Securely connect your GitLab Personal Access Token (with `api` scope).
4. Run the automated test — watch Guardian AI analyze your code in seconds.

---

## 💻 Developer Setup (Self-Hosting)

If you want to run the orbital orchestration engine locally on your own machine:

### Prerequisites
- Node.js 20+
- **Groq API Key** & **Gemini API Key**
- Resend API key (for email)
- ngrok installed

### Local Quick Start

```bash
# 1. Clone and install
git clone https://github.com/krish6542/Secura.git
cd guardian-ai
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your GROQ_API_KEY, GEMINI_API_KEY, and RESEND_API_KEY

# 3. Start development server
npm start
# Server auto-provisions a secure Ngrok tunnel for GitLab webhooks!
```

## ⚖️ License

MIT © 2026 Guardian AI Team
: Firestore queries are securely walled-off by `userId`. Passwords are encrypted with `bcrypt 12-rounds` and Gitlab keys are ferried seamlessly via Node `AsyncLocalStorage`.
- **Stateless Cloud Run Resiliency**: We use Google Cloud Run with `firebase-functions/v2`, allowing dynamic horizontal auto-scaling without ever dropping an AI workflow.

## Demo Video

## License

MIT © 2026 Guardian AI Team
