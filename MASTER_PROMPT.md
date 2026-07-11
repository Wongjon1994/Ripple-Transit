# Ripple Transit — Master Build Prompt for Claude Code

**Project Name:** Ripple Transit  
**Tagline:** Real-time urban mobility intelligence for Singapore  
**Status:** Build from scratch (all 12 phases)  
**Stack:** React 19 + Express 4 + tRPC 11 + Drizzle ORM + MySQL/TiDB  
**Design Inspiration:** The Daily Ripple (minimalist, typography-driven, data-focused)  

---

## 🎯 Project Vision

**Ripple Transit** is not just a transit app—it's an **intelligence platform** for understanding how Singapore moves. It combines real-time routing with AI-powered feasibility analysis to help commuters make smarter transit decisions.

**Core Insight:** Transit is a lens into urban life. By understanding how people move, you understand where they work, where they socialize, economic inequality, environmental impact, and city resilience.

**Future Evolution:** Two agentic modes (PULSE & FLUX) that learn from collective movement patterns to provide predictive routing and personalized recommendations.

---

## 📊 Project Scope (12 Phases)

### **Phase 1: Project Setup & Infrastructure** ✅
- Initialize Manus webdev project (React + Express + tRPC + Drizzle)
- Configure environment variables and secrets
- Set up database schema and migrations
- Create project README and documentation

### **Phase 2: Database Schema & Migrations** ✅
- Design 6 core tables: users, savedLocations, favouriteRoutes, apiUsageCounters, cachedTokens, mrtLineStatuses
- Create Drizzle schema with proper relationships
- Generate and apply migrations
- Set up database helpers

### **Phase 3: Authentication & User Management** ✅
- Implement Manus OAuth flow
- Create user session management
- Add protected procedures and role-based access control
- Build logout functionality

### **Phase 4: OneMap Integration** ✅
- Implement OneMap token lifecycle (3-day JWT with auto-refresh)
- Create search endpoint with HERE fallback
- Build routing endpoint
- Add token refresh job

### **Phase 5: MRT Service Integration** ✅
- Fetch MRT line statuses from LTA API
- Implement MRT operating hours validation
- Create train service alerts
- Build MRT leg validation logic

### **Phase 6: LTA Bus Integration** ✅
- Integrate LTA bus stops API
- Fetch live bus arrivals
- Build bus stop search
- Create nearby stops finder

### **Phase 7: HERE API Integration** ✅
- Implement HERE autosuggest fallback
- Track monthly usage with cap enforcement
- Build usage stats endpoint
- Create distance matrix helper

### **Phase 8: Frontend Layout & Navigation** ✅
- Create main App layout with routing
- Build navigation structure (map-first design)
- Implement theme system (light/dark mode)
- Add responsive breakpoints

### **Phase 9: Map Interface** ✅
- Integrate Leaflet map with OneMap tiles
- Build search panel (From/To inputs)
- Add origin/destination markers
- Implement map controls and zoom

### **Phase 10: Route Results Display** ✅
- Build route results panel
- Display all route legs (walk, MRT, bus)
- Show timing and cost information
- Add route polyline visualization

### **Phase 11: User Features** ✅
- Implement saved locations (CRUD)
- Build favourite routes (CRUD)
- Create settings panel
- Add MRT status display

### **Phase 12: Bus Feasibility Layer** 🔄
- Calculate bus feasibility (walking time vs ETA)
- Display feasibility badges (Green/Amber/Red)
- Build alternative buses UI
- Implement one-tap re-routing

---

## 🏗️ Architecture Overview

### **Frontend Stack**
- **Framework:** React 19 with Vite
- **Routing:** Wouter (lightweight, URL-based)
- **State Management:** tRPC hooks (useQuery, useMutation)
- **UI Components:** shadcn/ui (40+ components)
- **Styling:** Tailwind CSS 4 with custom theme
- **Maps:** Leaflet with OneMap tiles
- **Forms:** React Hook Form + Zod validation

### **Backend Stack**
- **Runtime:** Node.js with Express 4
- **RPC Framework:** tRPC 11 (end-to-end type safety)
- **Database:** Drizzle ORM with MySQL/TiDB
- **Authentication:** Manus OAuth + JWT sessions
- **External APIs:** OneMap, LTA, HERE

### **Database Schema**
```
users
├── id (PK)
├── email (unique)
├── role (admin | user)
├── createdAt

savedLocations
├── id (PK)
├── userId (FK)
├── label
├── address
├── lat, lng

favouriteRoutes
├── id (PK)
├── userId (FK)
├── label
├── origin, destination
├── createdAt

apiUsageCounters
├── service (PK1: "here")
├── month (PK2: "YYYY-MM")
├── count

cachedTokens
├── service (PK: "onemap")
├── token
├── expiresAt

mrtLineStatuses
├── lineCode (PK: "NS", "EW", etc.)
├── status (operational | disrupted)
├── lastUpdated
```

### **API Routes (tRPC Procedures)**
```
/api/trpc/
├── auth
│   ├── me (query)
│   └── logout (mutation)
├── onemap
│   ├── tokenInfo (query)
│   ├── search (query)
│   ├── route (query)
│   └── forceRefreshToken (mutation)
├── lta
│   ├── busArrivals (query)
│   ├── busStops (query)
│   └── nearbyStops (query)
├── mrt
│   ├── lineStatuses (query)
│   ├── operatingHours (query)
│   └── serviceAlerts (query)
├── here
│   └── usageStats (query)
├── savedLocations
│   ├── list (query)
│   ├── add (mutation)
│   ├── rename (mutation)
│   └── delete (mutation)
├── favouriteRoutes
│   ├── list (query)
│   ├── add (mutation)
│   ├── rename (mutation)
│   └── delete (mutation)
└── settings
    ├── get (query)
    └── set (mutation)
```

---

## 🎨 Design System

### **Inspiration: The Daily Ripple**
- Minimalist, whitespace-heavy layout
- Typography-driven hierarchy (size & weight, not color)
- Data-focused (show numbers + context)
- Subtle, sophisticated colors (not bright/saturated)
- Professional tone
- Accessible and keyboard-navigable

### **Color Palette**
| Usage | Color | Hex |
|-------|-------|-----|
| Background | Off-white | `#f8f9fa` |
| Text Primary | Dark grey | `#1f2937` |
| Text Secondary | Medium grey | `#6b7280` |
| Border | Light grey | `#e5e7eb` |
| OK/Success | Green | `#10b981` |
| Warning/Tight | Amber | `#f59e0b` |
| Error/Miss | Red | `#dc2626` |
| Transit Bus | Blue | `#3b82f6` |
| Transit MRT | Red | `#ef4444` |
| Transit Walk | Green | `#22c55e` |

### **Typography**
| Element | Font | Size | Weight | Line Height |
|---------|------|------|--------|------------|
| Heading | Inter/Sohne | 20px | 600 | 1.4 |
| Section Header | Same | 14px | 600 | 1.5 |
| Body | Same | 14px | 400 | 1.6 |
| Small | Same | 12px | 400 | 1.5 |

### **Spacing System (8px grid)**
- Small: 8px
- Medium: 12px
- Large: 16px
- XL: 24px
- XXL: 32px

---

## 📋 Implementation Checklist (12 Phases)

### Phase 1: Project Setup
- [ ] Initialize Manus webdev project
- [ ] Configure environment variables
- [ ] Set up git and version control
- [ ] Create project README

### Phase 2: Database
- [ ] Design schema (6 tables)
- [ ] Create Drizzle schema file
- [ ] Generate migrations
- [ ] Apply migrations to database
- [ ] Create database helpers

### Phase 3: Authentication
- [ ] Implement Manus OAuth
- [ ] Create user session management
- [ ] Add protected procedures
- [ ] Build logout functionality
- [ ] Add role-based access control

### Phase 4: OneMap Integration
- [ ] Implement token lifecycle management
- [ ] Create token refresh job
- [ ] Build search endpoint with HERE fallback
- [ ] Build routing endpoint
- [ ] Add error handling

### Phase 5: MRT Service
- [ ] Fetch MRT line statuses
- [ ] Implement operating hours validation
- [ ] Create train service alerts
- [ ] Build MRT leg validation
- [ ] Add MRT status display

### Phase 6: LTA Bus
- [ ] Integrate bus stops API
- [ ] Fetch live bus arrivals
- [ ] Build bus stop search
- [ ] Create nearby stops finder
- [ ] Add bus arrival display

### Phase 7: HERE API
- [ ] Implement autosuggest fallback
- [ ] Track monthly usage
- [ ] Enforce cap (29,950 calls/month)
- [ ] Build usage stats endpoint
- [ ] Add distance matrix helper

### Phase 8: Frontend Layout
- [ ] Create main App layout
- [ ] Build navigation structure
- [ ] Implement theme system
- [ ] Add responsive breakpoints
- [ ] Create layout components

### Phase 9: Map Interface
- [ ] Integrate Leaflet map
- [ ] Add OneMap tiles
- [ ] Build search panel
- [ ] Add origin/destination markers
- [ ] Implement map controls

### Phase 10: Route Results
- [ ] Build results panel
- [ ] Display all route legs
- [ ] Show timing and cost
- [ ] Add polyline visualization
- [ ] Implement leg details

### Phase 11: User Features
- [ ] Implement saved locations (CRUD)
- [ ] Build favourite routes (CRUD)
- [ ] Create settings panel
- [ ] Add MRT status display
- [ ] Build user profile

### Phase 12: Bus Feasibility
- [ ] Calculate feasibility (walking time vs ETA)
- [ ] Display feasibility badges (Green/Amber/Red)
- [ ] Build alternative buses UI
- [ ] Implement one-tap re-routing
- [ ] Add tests and polish

---

## 🎯 Key Features by Phase

### **Phases 1-7: Infrastructure & Integrations**
- Complete backend setup
- All external APIs integrated
- Database ready
- Authentication working

### **Phases 8-11: Core User Experience**
- Map-first interface
- Route search and display
- User preferences (saved locations, favourite routes)
- Real-time transit status

### **Phase 12: Intelligence Layer**
- Bus feasibility analysis
- Smart alternative suggestions
- One-tap re-routing
- Predictive insights

---

## 📱 User Flows

### **Flow 1: Search & Route**
1. User opens app → Sees map with search panel
2. Enters origin and destination
3. Clicks Search
4. App calculates routes and displays results
5. User sees feasibility badges for each bus leg
6. User can expand alternatives and re-route

### **Flow 2: Save Location**
1. User searches for a location
2. Clicks "Save this location"
3. Enters label (e.g., "Office", "Home")
4. Location saved to database
5. Available in search suggestions

### **Flow 3: Favourite Route**
1. User searches for a route
2. Clicks "Save this route"
3. Enters label (e.g., "Home to Office")
4. Route saved to database
5. Available in quick access

### **Flow 4: Check Transit Status**
1. User opens app
2. Sees MRT line statuses in sidebar
3. Clicks on line to see details
4. Views service alerts if any

---

## 🔧 External APIs

### **OneMap**
- **Endpoint:** https://www.onemap.gov.sg
- **Auth:** JWT token (3-day expiry)
- **Functions:** Search, routing, geocoding
- **Rate Limit:** Generous (no public limit)
- **Token Refresh:** Auto-refresh 6h before expiry

### **LTA (Land Transport Authority)**
- **Endpoint:** https://datamall2.mytransport.sg
- **Auth:** AccountKey header
- **Functions:** Bus stops, live arrivals, service alerts
- **Rate Limit:** 500 calls/min
- **Data:** Real-time bus positions, MRT statuses

### **HERE**
- **Endpoint:** https://autosuggest.search.hereapi.com
- **Auth:** API key
- **Functions:** Autosuggest, geocoding, distance matrix
- **Rate Limit:** 29,950 calls/month (enforced)
- **Fallback:** Used when OneMap returns 0 results

---

## 🧪 Testing Strategy

### **Unit Tests (Vitest)**
- Database helpers
- Bus feasibility calculations
- Token refresh logic
- API response parsing

### **Integration Tests**
- End-to-end route calculation
- Token lifecycle
- Database CRUD operations
- External API fallbacks

### **E2E Tests**
- User search flow
- Route saving
- Location saving
- Settings updates

### **Target:** 65+ tests passing

---

## 📊 Visual Mockups

All mockups are provided in the `mockups/` directory:

**Route Results & Feasibility:**
- `ripple-transit-mockup-1-feasibility-badges.png` — Green/Amber/Red states
- `ripple-transit-mockup-2-route-results.png` — Complete route results
- `ripple-transit-mockup-3-alternatives.png` — Alternative buses
- `ripple-transit-mockup-4-mobile.png` — Mobile version

**Map Views:**
- `ripple-transit-map-1-main-view.png` — Main map interface
- `ripple-transit-map-2-results-panel.png` — Map with results
- `ripple-transit-map-3-mobile-main.png` — Mobile map
- `ripple-transit-map-4-mobile-results.png` — Mobile results
- `ripple-transit-map-5-design-system.png` — Design system

---

## 🚀 Build Steps for Claude Code

### **Step 1: Project Setup (Phase 1)**
```bash
# Initialize Manus webdev project
# Configure environment variables
# Set up git
```

### **Step 2: Database (Phase 2)**
```bash
# Create Drizzle schema
# Generate migrations
# Apply migrations
# Create database helpers
```

### **Step 3: Backend Infrastructure (Phases 3-7)**
```bash
# Implement authentication
# Integrate OneMap
# Integrate MRT service
# Integrate LTA bus
# Integrate HERE API
```

### **Step 4: Frontend Layout (Phases 8-9)**
```bash
# Create main layout
# Build map interface
# Add search panel
# Implement navigation
```

### **Step 5: Core Features (Phases 10-11)**
```bash
# Build route results
# Add user features (saved locations, favourite routes)
# Implement settings
```

### **Step 6: Intelligence Layer (Phase 12)**
```bash
# Implement bus feasibility
# Build alternative buses UI
# Add one-tap re-routing
# Write tests and polish
```

---

## ✅ Success Criteria

### **Backend**
- ✅ All 7 external API integrations working
- ✅ Database schema complete with migrations
- ✅ Authentication working (Manus OAuth)
- ✅ 65+ tests passing
- ✅ No TypeScript errors

### **Frontend**
- ✅ Map interface working
- ✅ Route search and display working
- ✅ All user features working (saved locations, favourite routes)
- ✅ Bus feasibility badges displaying correctly
- ✅ Alternative buses UI functional
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

## 📚 Reference Files

See the `specifications/` directory for:
- `DATABASE_SCHEMA.md` — Complete database design
- `API_SPECIFICATION.md` — All tRPC procedures
- `FRONTEND_SPECS.md` — Page and component specifications
- `INTEGRATION_GUIDE.md` — External API integration details

See the `reference-code/` directory for:
- Example components
- Example procedures
- Example database helpers
- Testing patterns

---

## 💡 Key Principles

1. **Type Safety First** — Use TypeScript and Zod for validation
2. **Test-Driven** — Write tests as you build
3. **Design Consistency** — Reference mockups constantly
4. **Accessibility** — WCAG AA compliance
5. **Performance** — Optimize for mobile
6. **Error Handling** — Graceful fallbacks for API failures
7. **User Experience** — Smooth interactions, no jank

---

## 🎯 Estimated Timeline

- **Phase 1:** 1-2 hours (setup)
- **Phase 2:** 2-3 hours (database)
- **Phases 3-7:** 10-15 hours (backend integrations)
- **Phases 8-9:** 5-8 hours (frontend layout)
- **Phases 10-11:** 8-12 hours (core features)
- **Phase 12:** 13-18 hours (feasibility layer)

**Total: 40-60 hours**

---

## 🎬 Getting Started

1. **Read this file** (you're here!)
2. **Review the specifications** in `specifications/`
3. **Study the mockups** in `mockups/`
4. **Review reference code** in `reference-code/`
5. **Follow the build steps** above
6. **Reference this document** throughout development

---

**Good luck building Ripple Transit! This is an ambitious project with real-world impact. Let's ship it! 🚀**
