# TeleCMI Integration Specification & Enterprise Vendor Assessment
**Document Version:** 1.0  
**Project:** Tecstellar Command Center (TCC)  
**Target Audience:** Tecstellar Engineering Leadership & TeleCMI Account / Technical Team  

---

## 1. Executive Summary

Tecstellar Command Center (**TCC**) has implemented an in-browser CRM and calling workstation for managing customer outreach across Tecstellar products (**RealBroks**, **IronDrobe**, etc.). Agents dial customers directly from the web browser with zero desktop hardware, while supervisors and owners track team performance, call quality, and conversion funnels.

To provide automated post-call intelligence, TCC requires:
1. **In-Browser Web Calling (WebRTC)**
2. **Call Recordings Retrieval & Streaming**
3. **Call Transcription (Speech-to-Text with Speaker Diarization)**
4. **Post-Call Analytics (Customer Sentiment, AI Call Summary, Key Action Items)**

---

## 2. TeleCMI & PIOPIY API Capability Matrix

Based on TeleCMI's published developer documentation (`doc.telecmi.com`) and PIOPIY API specifications, here is the exact breakdown of what TeleCMI provides natively versus what requires external orchestration:

| Capability | TeleCMI Facility / Endpoint | Current Status | Notes / Limitations |
| :--- | :--- | :--- | :--- |
| **In-Browser Softphone** | `piopiyjs` WebRTC Browser SDK & Regional SIP SBCs (`sbcind.telecmi.com`) | **Fully Supported** | Agents authenticate per session. Softphone operates in-browser without hardware. |
| **Call Detail Records (CDR)** | Webhook HTTP POST (configured in CHUB dashboard) | **Fully Supported** | Delivers call duration, disposition, timestamps, recording filename, and custom JSON metadata (`extra_params`). |
| **Call Recording Retrieval** | `GET https://piopiy.telecmi.com/v1/play?appid={ID}&token={KEY}&file={NAME}` | **Fully Supported** | Streams or downloads the `.wav` audio file for recorded calls. |
| **Call Volume Analytics** | `POST https://piopiy.telecmi.com/v1/analysis` | **Basic Supported** | Returns aggregate counts only: `total`, `answered`, and `missed` calls within a time window. |
| **AI Transcription (Speech-to-Text)** | Proprietary Cloud CHUB Dashboard | **Enterprise Only / No Public REST API** | TeleCMI provides transcription inside their closed enterprise web dashboard, but **does not expose a public REST API endpoint** (`/v1/transcribe`) for external CRMs to query. |
| **Speech Analytics & Sentiment** | Proprietary Cloud CHUB Dashboard | **Enterprise Only / No Public REST API** | Sentiment analysis and conversational intelligence are available in TeleCMI's contact center UI, but cannot be fetched programmatically via REST API into an external app. |

---

## 3. Recommended Architectural Solution for TCC

Since TeleCMI provides the **call audio recording via `/v1/play`** but does not expose an open transcription/sentiment REST endpoint, TCC employs the industry-standard CRM pipeline:

```
┌────────────────────────────────────────────────────────┐
│ 1. In-App WebRTC Call via TeleCMI piopiyjs             │
└──────────────────────────┬─────────────────────────────┘
                           │ Call completes
┌──────────────────────────▼─────────────────────────────┐
│ 2. TeleCMI Webhook fires CDR with recording filename   │
└──────────────────────────┬─────────────────────────────┘
                           │ TCC Webhook Receiver
┌──────────────────────────▼─────────────────────────────┐
│ 3. Fetch Call Audio Stream:                            │
│    https://piopiy.telecmi.com/v1/play?file=...         │
└──────────────────────────┬─────────────────────────────┘
                           │ Audio Ingestion
┌──────────────────────────▼─────────────────────────────┐
│ 4. Automated AI Audio Processing (Gemini / Whisper):   │
│    • Verbatim Transcript (Agent vs. Customer)          │
│    • Sentiment Score (+1.0 to -1.0) & Churn Risk Flag  │
│    • 2-sentence AI Call Summary & Action Items         │
└──────────────────────────┬─────────────────────────────┘
                           │ Stored in TCC Database
┌──────────────────────────▼─────────────────────────────┐
│ 5. Rendered across TCC Surfaces:                       │
│    • Agent Workspace: Audio Player & Transcript Drawer │
│    • Supervisor: Team Sentiment & Priority QA Audits   │
│    • Owner: Cross-App Sentiment Health & Churn Alerts  │
└────────────────────────────────────────────────────────┘
```

### Benefits of this Architecture:
1. **Multi-Lingual Accuracy**: Full support for Indian regional languages and mixed code-switching (Tamil, Telugu, Kannada, Hindi, and Indian English).
2. **Zero Vendor Lock-in**: TCC maintains ownership of customer transcripts, sentiment history, and extracted sales insights.
3. **Real-time Synchronization**: As soon as a call ends, audio and transcription are immediately tied to the customer's profile.

---

## 4. Inquiries & Requirements for the TeleCMI Team

Below is the structured questionnaire to share with TeleCMI's account executive and engineering team:

### A. API Endpoints & Plan Level
1. **Transcription API Access**: Does TeleCMI offer an API endpoint or webhook callback to receive raw transcriptions and speaker labels directly, or is transcription restricted to the CHUB web interface?
2. **Speech Analytics API**: Is there an enterprise plan that exposes sentiment scores and keyword detection via REST API or webhook payloads?
3. **`/v1/play` Recording Retention**: How long are `.wav` audio files retained on `piopiy.telecmi.com` before archiving or expiration?
4. **Direct S3 / Cloud Storage Export**: Can TeleCMI automatically stream call recordings directly into a Tecstellar-owned Google Cloud Storage or AWS S3 bucket upon call completion?

### B. Softphone & Telephony Operations
5. **Agent Seat Concurrency**: How many simultaneous browser softphone sessions (`piopiyjs`) are permitted under our current plan?
6. **Token Authentication**: Can TeleCMI provide temporary scoped agent auth tokens rather than requiring agent SIP passwords on client devices?
7. **Webhook Reliability**: What are TeleCMI's retry policies and SLA for webhook delivery if our webhook receiver experiences brief downtime?

---

## 5. Ready-to-Send Communication Templates

### Template 1: Message to TeleCMI Account Manager / Support Team

> **Subject:** API Integration Requirements: Call Recordings, Webhooks & Speech Analytics for Tecstellar CRM (TCC)
>
> Dear TeleCMI Team,
>
> We have successfully integrated TeleCMI's WebRTC browser softphone (`piopiyjs`) and CDR webhooks into our internal CRM platform, **Tecstellar Command Center (TCC)**. Our agents are making and logging calls directly through the browser.
>
> We are now finalizing the post-call intelligence layer (call recordings, transcriptions, and speech analytics) and would like clarification on the following items for our account:
>
> 1. **Recording Audio Access (`/v1/play`)**: We are accessing call audio using `GET https://piopiy.telecmi.com/v1/play`. What is the retention window for these audio files, and can automated export to our private cloud bucket (GCS/S3) be enabled?
> 2. **AI Transcription & Speech Analytics via API**: We notice TeleCMI offers speech analytics and transcription within the CHUB dashboard. Does TeleCMI offer a REST API or webhook extension to deliver transcripts and sentiment data directly to our backend, or is this feature restricted to your closed UI?
> 3. **CDR Webhook Details**: Can we confirm that custom tags passed via `extra_params` in `piopiyjs` are guaranteed to return in the post-call CDR webhook for all outgoing call legs?
> 4. **Enterprise Upgrades**: If programmatic transcription and speech analytics require an Enterprise plan tier, please provide the relevant API documentation and commercial terms.
>
> Looking forward to your prompt response.
>
> Best regards,  
> **Tecstellar Engineering Team**

---

### Template 2: Briefing Note for Internal Team / Leadership

> **Team Update: TeleCMI Integration & AI Post-Call Intelligence Status**
>
> **What is Complete:**
> - In-browser softphone calling (`piopiyjs`) is active in the Agent Workspace with mute, hold, dial pad, and WebRTC media quality diagnostics (detects microphone drops and one-way audio).
> - Call recording playback is integrated with an in-app audio player supporting scrubbing, speed controls (1x, 1.25x, 1.5x), and download.
> - Post-call AI transcriptions, sentiment analysis (+1.0 to -1.0 score), call summaries, and extracted action items are live with an interactive slide-out transcript drawer.
> - Supervisor Team Performance now features a **Call Quality QA Audit** dashboard to audit flagged calls with churn risk in 1 click.
> - Owner Dashboard includes organization-wide TeleCMI call health and per-app customer sentiment indices.
>
> **TeleCMI Vendor Reality:**
> - TeleCMI provides recording storage and audio streaming (`/v1/play`), volume analytics (`/v1/analysis`), and CDR webhooks.
> - TeleCMI does **not** expose a public REST API for automated transcriptions and sentiment data (their speech AI is locked to their proprietary dashboard).
> - As standard practice, TCC takes TeleCMI's audio recordings and processes them through our automated AI speech pipeline, ensuring high accuracy across Indian regional languages (Tamil, Telugu, Hindi, English).
