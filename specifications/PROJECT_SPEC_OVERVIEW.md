# Ripple Transit — Complete Project Specification

**Build from scratch for Claude Code**

---

## 📦 What's Inside

This package contains everything Claude Code needs to build **Ripple Transit** from scratch, end-to-end.

```
ripple-transit-complete/
├── MASTER_PROMPT.md              ← START HERE
├── README.md                      ← You are here
├── documentation/
│   ├── DESIGN_PRINCIPLES_REFERENCE.md
│   ├── PHASE_12_MOCKUPS.md
│   └── CLAUDE_CODE_FILE_MANIFEST.md
├── specifications/
│   ├── DATABASE_SCHEMA.md         ← Database design
│   ├── API_SPECIFICATION.md       ← All tRPC procedures
│   ├── FRONTEND_SPECS.md          ← Pages & components
│   └── INTEGRATION_GUIDE.md       ← External APIs
├── mockups/                       ← 9 visual mockups
│   ├── ripple-transit-mockup-1-feasibility-badges.png
│   ├── ripple-transit-mockup-2-route-results.png
│   ├── ripple-transit-mockup-3-alternatives.png
│   ├── ripple-transit-mockup-4-mobile.png
│   ├── ripple-transit-map-1-main-view.png
│   ├── ripple-transit-map-2-results-panel.png
│   ├── ripple-transit-map-3-mobile-main.png
│   ├── ripple-transit-map-4-mobile-results.png
│   └── ripple-transit-map-5-design-system.png
└── reference-code/                ← Example implementations
    ├── example-components.tsx
    ├── example-procedures.ts
    ├── example-db-helpers.ts
    └── example-tests.test.ts
```

---

## 🚀 Quick Start for Claude Code

### **Step 1: Read the Master Prompt**
Start with `MASTER_PROMPT.md` — it contains the complete project vision, scope, and implementation plan.

### **Step 2: Review the Specifications**
1. `DATABASE_SCHEMA.md` — Understand the 6 database tables
2. `API_SPECIFICATION.md` — Learn all tRPC procedures
3. `FRONTEND_SPECS.md` — See page layouts and components

### **Step 3: Study the Mockups**
Review all 9 mockups in the `mockups/` directory to understand the visual design.

### **Step 4: Reference the Code Examples**
Look at `reference-code/` for patterns and examples.

### **Step 5: Build Phase by Phase**
Follow the 12 phases outlined in `MASTER_PROMPT.md`:
- Phases 1-7: Backend infrastructure
- Phases 8-9: Frontend layout
- Phases 10-11: Core features
- Phase 12: Bus feasibility layer

---

## 📋 Project Overview

**Ripple Transit** is a real-time urban mobility intelligence platform for Singapore that combines route planning with AI-powered bus feasibility analysis.

**Key Features:**
- 🗺️ Map-based route search
- 🚌 Live bus arrivals with feasibility analysis
- 🚇 MRT status and operating hours
- 💾 Saved locations and favourite routes
- 🎨 Minimalist, data-focused design (inspired by The Daily Ripple)

**Tech Stack:**
- Frontend: React 19 + Vite + Tailwind CSS 4 + shadcn/ui
- Backend: Express 4 + tRPC 11 + Drizzle ORM
- Database: MySQL/TiDB
- Maps: Leaflet with OneMap tiles
- Auth: Manus OAuth + JWT sessions

---

## 🎯 Implementation Phases

| Phase | Title | Status | Duration |
|-------|-------|--------|----------|
| 1 | Project Setup | 📋 Spec | 1-2h |
| 2 | Database Schema | 📋 Spec | 2-3h |
| 3 | Authentication | 📋 Spec | 2-3h |
| 4 | OneMap Integration | 📋 Spec | 2-3h |
| 5 | MRT Service | 📋 Spec | 2-3h |
| 6 | LTA Bus Integration | 📋 Spec | 2-3h |
| 7 | HERE API | 📋 Spec | 2-3h |
| 8 | Frontend Layout | 📋 Spec | 2-3h |
| 9 | Map Interface | 📋 Spec | 3-4h |
| 10 | Route Results | 📋 Spec | 3-4h |
| 11 | User Features | 📋 Spec | 3-4h |
| 12 | Bus Feasibility | 📋 Spec | 13-18h |
| **Total** | | | **40-60h** |

---

## 📊 Database Schema (6 Tables)

1. **users** — User accounts and authentication
2. **savedLocations** — User's saved locations
3. **favouriteRoutes** — User's favourite routes
4. **apiUsageCounters** — Track HERE API monthly usage
5. **cachedTokens** — Cache OneMap JWT tokens
6. **mrtLineStatuses** — Cache MRT line statuses

See `specifications/DATABASE_SCHEMA.md` for complete schema.

---

## 🔌 External APIs

| API | Purpose | Auth | Rate Limit | Cap |
|-----|---------|------|-----------|-----|
| **OneMap** | Search, routing, geocoding | JWT (3-day) | Generous | None |
| **LTA** | Bus arrivals, MRT status | AccountKey | 500/min | None |
| **HERE** | Autosuggest fallback | API Key | Generous | 29,950/month |

See `specifications/INTEGRATION_GUIDE.md` for details.

---

## 🎨 Design System

**Inspiration:** The Daily Ripple (minimalist, typography-driven, data-focused)

**Color Palette:**
- Background: `#f8f9fa` (off-white)
- Text: `#1f2937` (dark grey)
- OK: `#10b981` (green)
- Warning: `#f59e0b` (amber)
- Error: `#dc2626` (red)

**Typography:**
- Heading: 20px, 600 weight
- Body: 14px, 400 weight
- Small: 12px, 400 weight

**Spacing:** 8px grid (8, 12, 16, 24, 32px)

See `documentation/DESIGN_PRINCIPLES_REFERENCE.md` for complete design system.

---

## 📱 Pages & Components

**Pages:**
1. **Home** — Map with search panel
2. **Route Results** — Display calculated routes
3. **Saved Locations** — Manage saved locations
4. **Favourite Routes** — Manage favourite routes
5. **Settings** — User preferences and transit status

**Key Components:**
- SearchPanel
- RouteResultsPanel
- FeasibilityBadge (Green/Amber/Red)
- AlternativeBuses
- MrtStatusDisplay
- SavedLocationCard
- RouteCard

See `specifications/FRONTEND_SPECS.md` for complete page specs.

---

## 🧪 Testing

**Target:** 65+ tests passing

**Test Types:**
- Unit tests (database helpers, calculations)
- Integration tests (API flows, token lifecycle)
- E2E tests (user journeys)

**Tools:** Vitest

See `reference-code/example-tests.test.ts` for patterns.

---

## 📐 API Routes (tRPC)

```
/api/trpc/
├── auth.me
├── auth.logout
├── onemap.tokenInfo
├── onemap.search
├── onemap.route
├── onemap.forceRefreshToken
├── lta.busArrivals
├── lta.busStops
├── lta.nearbyStops
├── mrt.lineStatuses
├── mrt.operatingHours
├── mrt.serviceAlerts
├── here.usageStats
├── savedLocations.list
├── savedLocations.add
├── savedLocations.rename
├── savedLocations.delete
├── favouriteRoutes.list
├── favouriteRoutes.add
├── favouriteRoutes.rename
├── favouriteRoutes.delete
├── settings.get
└── settings.set
```

See `specifications/API_SPECIFICATION.md` for complete API docs.

---

## 🎯 Success Criteria

### **Backend**
- ✅ All 7 external API integrations working
- ✅ Database schema complete with migrations
- ✅ Authentication working (Manus OAuth)
- ✅ 65+ tests passing
- ✅ No TypeScript errors

### **Frontend**
- ✅ Map interface working
- ✅ Route search and display working
- ✅ All user features working
- ✅ Bus feasibility badges displaying correctly
- ✅ Mobile responsive (375px+)
- ✅ Dark mode working
- ✅ Accessibility compliant (WCAG AA)

### **Design**
- ✅ UI matches mockups pixel-perfectly
- ✅ Ripple design principles applied
- ✅ Typography hierarchy clear
- ✅ Colors match design system
- ✅ Spacing consistent (8px grid)

### **Deployment**
- ✅ Checkpoint saved
- ✅ Published to production
- ✅ Live site accessible
- ✅ All features working on live site

---

## 📚 File Guide

| File | Purpose |
|------|---------|
| `MASTER_PROMPT.md` | Complete project vision and implementation plan |
| `DATABASE_SCHEMA.md` | 6 database tables with Drizzle schema |
| `API_SPECIFICATION.md` | All 20+ tRPC procedures with examples |
| `FRONTEND_SPECS.md` | 5 pages with layouts and components |
| `INTEGRATION_GUIDE.md` | External API integration details |
| `DESIGN_PRINCIPLES_REFERENCE.md` | Design system and principles |
| `PHASE_12_MOCKUPS.md` | Detailed bus feasibility specs |
| `CLAUDE_CODE_FILE_MANIFEST.md` | Reference file list from original project |
| `mockups/*.png` | 9 visual mockups (pixel-perfect references) |
| `reference-code/*.ts` | Example implementations |

---

## 🔑 Key Principles

1. **Type Safety First** — Use TypeScript and Zod for validation
2. **Test-Driven** — Write tests as you build
3. **Design Consistency** — Reference mockups constantly
4. **Accessibility** — WCAG AA compliance
5. **Performance** — Optimize for mobile
6. **Error Handling** — Graceful fallbacks for API failures
7. **User Experience** — Smooth interactions, no jank

---

## 💡 Implementation Tips

1. **Start with Phase 1** — Project setup and configuration
2. **Build database first** — Schema and migrations
3. **Implement backend APIs** — Phases 3-7 (integrations)
4. **Build frontend layout** — Phases 8-9 (pages and components)
5. **Add core features** — Phases 10-11 (user features)
6. **Implement intelligence layer** — Phase 12 (bus feasibility)
7. **Test thoroughly** — Write tests as you build
8. **Reference mockups** — Compare UI against mockups constantly

---

## 🚀 Estimated Timeline

- **Phases 1-2:** 3-5 hours (setup + database)
- **Phases 3-7:** 10-15 hours (backend integrations)
- **Phases 8-9:** 5-8 hours (frontend layout)
- **Phases 10-11:** 8-12 hours (core features)
- **Phase 12:** 13-18 hours (feasibility layer)

**Total: 40-60 hours**

---

## 📞 Questions?

Refer to the specific specification files:
- Database questions → `DATABASE_SCHEMA.md`
- API questions → `API_SPECIFICATION.md`
- Frontend questions → `FRONTEND_SPECS.md`
- Design questions → `DESIGN_PRINCIPLES_REFERENCE.md`
- Integration questions → `INTEGRATION_GUIDE.md`

---

## ✅ Checklist for Claude Code

- [ ] Read `MASTER_PROMPT.md`
- [ ] Review all mockups in `mockups/`
- [ ] Study `DATABASE_SCHEMA.md`
- [ ] Study `API_SPECIFICATION.md`
- [ ] Study `FRONTEND_SPECS.md`
- [ ] Review reference code in `reference-code/`
- [ ] Phase 1: Project setup
- [ ] Phase 2: Database schema
- [ ] Phases 3-7: Backend integrations
- [ ] Phases 8-9: Frontend layout
- [ ] Phases 10-11: Core features
- [ ] Phase 12: Bus feasibility
- [ ] Testing (65+ tests)
- [ ] Deployment & checkpoint

---

**Good luck building Ripple Transit! This is an ambitious project with real-world impact. Let's ship it! 🚀**
