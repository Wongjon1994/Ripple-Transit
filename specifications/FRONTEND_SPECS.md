# Ripple Transit — Frontend Specifications

**Framework:** React 19 + Vite  
**Routing:** Wouter  
**UI Components:** shadcn/ui (40+ components)  
**Styling:** Tailwind CSS 4  
**Maps:** Leaflet with OneMap tiles  

---

## Page Structure

```
App.tsx (Main router)
├── Home.tsx (Map + Search)
├── RouteResults.tsx (Results panel)
├── SavedLocations.tsx (Manage locations)
├── FavouriteRoutes.tsx (Manage routes)
├── Settings.tsx (User settings)
└── NotFound.tsx (404)
```

---

## Page 1: Home (Map + Search)

**Route:** `/`  
**Purpose:** Main interface with map and search

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ Ripple Transit  [Settings] [Theme]              │
├─────────────────────────────────────────────────┤
│ ┌─────────────┐                                 │
│ │ FROM        │                                 │
│ │ [input]     │                                 │
│ ├─────────────┤                                 │
│ │ TO          │                                 │
│ │ [input]     │                                 │
│ ├─────────────┤                                 │
│ │ DEPART      │                                 │
│ │ [date/time] │                                 │
│ ├─────────────┤                                 │
│ │ [SEARCH]    │                                 │
│ ├─────────────┤                                 │
│ │ Saved       │                                 │
│ │ Locations   │                                 │
│ │ • Home      │         LEAFLET MAP             │
│ │ • Office    │                                 │
│ ├─────────────┤                                 │
│ │ Favourite   │                                 │
│ │ Routes      │                                 │
│ │ • Home→Off  │                                 │
│ │ • Off→Home  │                                 │
│ └─────────────┘                                 │
└─────────────────────────────────────────────────┘
```

**Components:**
- SearchPanel (left sidebar)
  - From input with autocomplete
  - To input with autocomplete
  - Date/time picker
  - Search button
  - Saved locations list
  - Favourite routes list
- Map (center)
  - Leaflet map with OneMap tiles
  - Origin marker (blue)
  - Destination marker (red)
  - Route polyline
  - Zoom controls
- Header
  - App title
  - Settings button
  - Theme toggle

**State:**
```typescript
const [from, setFrom] = useState('');
const [to, setTo] = useState('');
const [date, setDate] = useState(new Date());
const [time, setTime] = useState('');
const [searchResults, setSearchResults] = useState([]);
const [selectedRoute, setSelectedRoute] = useState(null);
```

**Interactions:**
- Type in From/To inputs → trigger search
- Click saved location → populate From/To
- Click favourite route → populate From/To
- Click Search → fetch routes
- Click on route → show results panel
- Drag on map → update search

---

## Page 2: Route Results

**Route:** `/results` or modal overlay  
**Purpose:** Display calculated routes with feasibility

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ ROUTE RESULTS                            [X]    │
├─────────────────────────────────────────────────┤
│ 35 min · $2.80 · 1 transfer                     │
├─────────────────────────────────────────────────┤
│ 1. WALK (8 min, 650m)                           │
│    Raffles Place → Orchard Road MRT             │
│    Via Collyer Quay and Cross St.               │
├─────────────────────────────────────────────────┤
│ 2. MRT (12 min, 2 stops)                        │
│    Orchard Road → Dhoby Ghaut                   │
│    ✓ OK (Operating)                             │
├─────────────────────────────────────────────────┤
│ 3. BUS 175 (8 min)                              │
│    Depart: 10:15 AM, Walk: ~8 min, ETA: 10:23  │
│                                                  │
│    ✓ OK — 3 minute buffer                       │
│    You'll arrive about 3 min before your        │
│    target time.                                  │
│                                                  │
│    [View arrivals] [Show alternatives ▼]        │
├─────────────────────────────────────────────────┤
│ [Save this route]                               │
└─────────────────────────────────────────────────┘
```

**Components:**
- RouteResultsPanel
  - Summary (duration, cost, transfers)
  - Route legs (walk, MRT, bus)
  - Feasibility badges (Phase 12)
  - Alternative buses section
  - Save route button

**Feasibility Badge States:**
- **Green (OK):** ✓ OK — X minute buffer
- **Amber (Tight):** ⚠ TIGHT — X minute buffer
- **Red (Miss):** ✕ MISS — You won't make it
- **Grey (Unknown):** ? Unknown — Live data unavailable

**Alternative Buses:**
- Collapsed: "[▼ Show N alternatives]"
- Expanded: List of up to 3 buses with:
  - Service number
  - ETA
  - Feasibility status
  - "[Take this bus →]" button

**State:**
```typescript
const [selectedRoute, setSelectedRoute] = useState(null);
const [showAlternatives, setShowAlternatives] = useState(false);
const [selectedAlternative, setSelectedAlternative] = useState(null);
```

---

## Page 3: Saved Locations

**Route:** `/saved-locations`  
**Purpose:** Manage saved locations

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ SAVED LOCATIONS                          [+]    │
├─────────────────────────────────────────────────┤
│ Home                                            │
│ 123 Raffles Avenue, Singapore 039803            │
│ [Edit] [Delete]                                 │
├─────────────────────────────────────────────────┤
│ Office                                          │
│ 50 Raffles Place, Singapore 048623              │
│ [Edit] [Delete]                                 │
├─────────────────────────────────────────────────┤
│ Gym                                             │
│ 1 Clementi Road, Singapore 129742               │
│ [Edit] [Delete]                                 │
└─────────────────────────────────────────────────┘
```

**Components:**
- LocationCard (reusable)
  - Label
  - Address
  - Edit button
  - Delete button
- AddLocationModal
  - Label input
  - Address input
  - Save button

**Interactions:**
- Click [+] → open add modal
- Click [Edit] → open edit modal
- Click [Delete] → confirm delete
- Type address → autocomplete suggestions

---

## Page 4: Favourite Routes

**Route:** `/favourite-routes`  
**Purpose:** Manage favourite routes

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ FAVOURITE ROUTES                         [+]    │
├─────────────────────────────────────────────────┤
│ Home to Office                                  │
│ Raffles Place → Orchard Road                    │
│ [Edit] [Delete]                                 │
├─────────────────────────────────────────────────┤
│ Office to Home                                  │
│ Orchard Road → Raffles Place                    │
│ [Edit] [Delete]                                 │
└─────────────────────────────────────────────────┘
```

**Components:**
- RouteCard (reusable)
  - Label
  - Origin → Destination
  - Edit button
  - Delete button
- AddRouteModal
  - Label input
  - Origin input (autocomplete)
  - Destination input (autocomplete)
  - Save button

---

## Page 5: Settings

**Route:** `/settings`  
**Purpose:** User preferences and configuration

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ SETTINGS                                        │
├─────────────────────────────────────────────────┤
│ ACCOUNT                                         │
│ Email: user@example.com                         │
│ Role: User                                      │
│ [Logout]                                        │
├─────────────────────────────────────────────────┤
│ PREFERENCES                                     │
│ Theme: [Light] [Dark]                           │
│ Language: [English]                             │
├─────────────────────────────────────────────────┤
│ TRANSIT STATUS                                  │
│ NS Line: Operational ✓                          │
│ EW Line: Operational ✓                          │
│ CC Line: Operational ✓                          │
│ NE Line: Operational ✓                          │
│ DT Line: Operational ✓                          │
│ TE Line: Operational ✓                          │
├─────────────────────────────────────────────────┤
│ API USAGE                                       │
│ HERE: 150 / 29,950 calls (0.5%)                │
│ [Reset] (admin only)                            │
└─────────────────────────────────────────────────┘
```

**Components:**
- AccountSection
  - Email display
  - Role display
  - Logout button
- PreferencesSection
  - Theme toggle
  - Language selector
- TransitStatusSection
  - MRT line statuses
  - Status indicators
- ApiUsageSection
  - HERE usage bar
  - Reset button (admin)

---

## Component Library (shadcn/ui)

**Layout Components:**
- Card
- Separator
- Tabs
- Accordion

**Form Components:**
- Input
- Button
- Select
- DatePicker
- TimePicker
- Checkbox
- Radio

**Feedback Components:**
- Toast (Sonner)
- Dialog
- AlertDialog
- Tooltip

**Navigation Components:**
- Breadcrumb
- Pagination

**Data Display:**
- Table
- Badge
- Progress

---

## Design Tokens

**Colors:**
```typescript
const colors = {
  background: '#f8f9fa',
  foreground: '#1f2937',
  muted: '#6b7280',
  border: '#e5e7eb',
  ok: '#10b981',
  warning: '#f59e0b',
  error: '#dc2626',
  busBlue: '#3b82f6',
  mrtRed: '#ef4444',
  walkGreen: '#22c55e',
};
```

**Spacing:**
```typescript
const spacing = {
  xs: '8px',
  sm: '12px',
  md: '16px',
  lg: '24px',
  xl: '32px',
};
```

**Typography:**
```typescript
const typography = {
  h1: { size: '20px', weight: 600, lineHeight: 1.4 },
  h2: { size: '14px', weight: 600, lineHeight: 1.5 },
  body: { size: '14px', weight: 400, lineHeight: 1.6 },
  small: { size: '12px', weight: 400, lineHeight: 1.5 },
};
```

---

## State Management

**Global State (Context):**
```typescript
// AuthContext
- user: User | null
- isLoading: boolean
- startLogin: () => void
- logout: () => void

// ThemeContext
- theme: 'light' | 'dark'
- toggleTheme: () => void

// TransitContext
- selectedRoute: Route | null
- setSelectedRoute: (route: Route) => void
- showAlternatives: boolean
- setShowAlternatives: (show: boolean) => void
```

**Local State (Component):**
- Form inputs (From, To, Date, Time)
- Search results
- Loading states
- Error messages

**Server State (tRPC):**
- Route results
- Saved locations
- Favourite routes
- MRT statuses
- HERE usage stats

---

## Responsive Design

**Breakpoints:**
- Mobile: 0-640px
- Tablet: 641-1024px
- Desktop: 1025px+

**Mobile Optimizations:**
- Full-screen map
- Bottom sheet for results
- Stacked buttons
- Larger touch targets (44px+)

**Desktop Optimizations:**
- Sidebar search panel
- Side-by-side layout
- Hover effects

---

## Accessibility

**Keyboard Navigation:**
- Tab through all interactive elements
- Enter to submit forms
- Escape to close modals
- Arrow keys for date/time pickers

**Screen Readers:**
- ARIA labels on all buttons
- Form labels associated with inputs
- Status announcements for async operations

**Color Contrast:**
- 4.5:1 ratio for text
- 3:1 ratio for UI components

**Focus Indicators:**
- Visible focus rings on all interactive elements
- High contrast focus states

---

## Performance

**Code Splitting:**
- Lazy load route pages
- Lazy load modals

**Image Optimization:**
- Optimize map tiles
- Lazy load images

**Caching:**
- Cache route results
- Cache bus stops (24h)
- Cache MRT statuses (1h)

**Bundle Size:**
- Target: <200KB gzipped
- Monitor with bundlesize

---

## Testing

**Unit Tests:**
- Component rendering
- User interactions
- State updates

**Integration Tests:**
- Search flow
- Route calculation
- Saving locations/routes

**E2E Tests:**
- Full user journey
- Mobile responsiveness
- Dark mode

**Target:** 80%+ coverage
