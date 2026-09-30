# WFG Weekly Manager Report Portal

An internal reporting platform built for **WFG Title** to streamline weekly manager reporting, consolidate operational updates, and provide leadership with clear, actionable insights.

## Overview

The WFG Weekly Manager Report Portal replaces the traditional Word-document reporting process with a centralized digital workflow.

Managers can submit their weekly updates through the portal, while administrators and leadership can monitor submissions, review historical reports, generate consolidated summaries, and create leadership-focused reporting.

The platform is designed to make weekly reporting easier to **collect, consolidate, analyze, and communicate**.

---

## Features

### Manager Reporting

Managers can:

- Securely sign in to the portal
- View the current reporting week
- Track the weekly submission deadline
- Create a weekly report
- Save reports as drafts
- Continue previously saved drafts
- Submit completed reports
- Review submitted reports

Each weekly report captures four key areas:

- **Wins / Highlights**
- **Challenges / Risks**
- **Needs / Requests**
- **Notes / Other**

---

### Admin Dashboard

Administrators can:

- Monitor weekly reporting activity
- View Submitted, Draft, and Not Started statuses
- Review individual manager submissions
- Track overall submission progress
- Navigate between current and historical reporting weeks

---

### Weekly Summary

The Weekly Summary consolidates submitted manager reports into a single view for the selected reporting week.

It provides leadership with a structured overview of:

- Wins and highlights
- Challenges and risks
- Needs and requests
- Additional notes and operational updates

---

### Executive Summary

The portal includes AI-assisted executive analysis that transforms submitted manager reports into a concise leadership-level summary.

The generated analysis highlights:

- Executive Overview
- Wins & Positive Trends
- Challenges & Risks
- Needs & Requests
- Notable Updates

Executive summaries can be generated for current and historical reporting weeks.

---

### Leadership Report

The Leadership Report provides a polished, leadership-focused view of weekly operational information.

It is designed to make important developments, trends, risks, and priorities easier to review and communicate.

---

### Print-Friendly Reporting

Leadership-facing reports include optimized print layouts with WFG branding for clean presentation and distribution.

---

## AI Video Creation

The portal is being expanded with an **AI Video Creation** workflow that will transform weekly reports into short, branded storytelling videos.

The planned workflow is:

**Source → Storyboard → Template → Review → Generate → Preview & Download**

Video creation is being designed to support:

- Weekly Summary as a source
- Leadership Report as a source
- Uploaded reports and documents
- AI-generated storytelling and narration
- Personalized AI presenters
- Reusable avatars
- Personalized voices
- Saved presenter profiles
- Dynamic report-based scenes
- Charts and animated metrics
- Relevant imagery and supporting visuals
- Product and report screenshots
- Captions
- Scene transitions
- WFG branding
- Branded intro and outro
- 1–2 minute video generation
- Video preview and download

The goal is to create a different visual story each week based on the actual content of the selected report rather than simply converting the report into a static presentation.

> **Status:** AI Video Creation is currently in development.

---

## Technology Stack

### Frontend

- React
- TypeScript
- Vite

### Backend & Database

- Supabase
- PostgreSQL
- Supabase Authentication
- Row Level Security (RLS)

### Hosting

- Vercel

### AI

Server-side AI processing is used to analyze submitted reports and generate leadership-level summaries.

---

## Reporting Workflow

```text
Manager Reports
       ↓
Weekly Submissions
       ↓
Admin Review
       ↓
Weekly Summary
       ↓
Executive Analysis
       ↓
Leadership Report
       ↓
AI Video Story
```

---

## Report Status

Manager reports progress through the following states:

```text
Not Started → Draft → Submitted
```

Drafts can be saved and continued before final submission.

Submitted reports are preserved for administrative and leadership review.

---

## Historical Reporting

Administrators can navigate between reporting weeks to review previous manager submissions, summaries, and leadership reporting.

This allows the portal to serve as a centralized historical record of weekly operational reporting.

---

## Local Development

Install project dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

The local application will typically be available at:

```text
http://localhost:5173
```

---

The application will typically be available at:

```text
[https://wfg-weekly-manager-portal.vercel.app/]
```


## Production Build

Create a production build:

```bash
npm run build
```

Run linting:

```bash
npm run lint
```

---

## Security

The application uses authentication, role-based access, and database Row Level Security.

Sensitive credentials must remain server-side.

Never commit:

- API keys
- Supabase service credentials
- AI service credentials
- Authentication secrets
- `.env` files containing sensitive values

---

## Project Goal

The WFG Weekly Manager Report Portal is designed to transform weekly reporting from a manual document-based process into a centralized reporting and communication platform.

The long-term workflow is:

**Collect → Consolidate → Analyze → Communicate**

Managers provide their updates once, and the platform transforms that information into increasingly useful formats for leadership — from individual submissions to consolidated weekly summaries, executive insights, leadership reports, and AI-generated video stories.

---

## Internal Use

This project is intended for internal **WFG Title** use.
