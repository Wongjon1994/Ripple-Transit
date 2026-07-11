# Ripple Transit — API Specification (tRPC)

**Framework:** tRPC 11  
**Base Path:** `/api/trpc`  
**Authentication:** Manus OAuth + JWT sessions  
**Type Safety:** End-to-end with TypeScript + Zod  

---

## Router Structure

```
appRouter
├── system (systemRouter)
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

## Auth Router

### `auth.me` (Query)

**Purpose:** Get current user info  
**Access:** Public  
**Input:** None  
**Output:**
```typescript
{
  id: number;
  email: string;
  role: 'user' | 'admin';
}
```

**Example:**
```typescript
const user = await trpc.auth.me.useQuery();
// Returns: { id: 1, email: 'user@example.com', role: 'user' }
```

---

### `auth.logout` (Mutation)

**Purpose:** Clear user session  
**Access:** Public  
**Input:** None  
**Output:**
```typescript
{ success: true }
```

**Example:**
```typescript
await trpc.auth.logout.useMutation();
// Clears session cookie and redirects to login
```

---

## OneMap Router

### `onemap.tokenInfo` (Query)

**Purpose:** Get OneMap token expiry info  
**Access:** Public  
**Input:** None  
**Output:**
```typescript
{
  expiresAt: number;  // Unix timestamp (seconds)
  issuedAt: number;   // Unix timestamp (seconds)
}
```

**Example:**
```typescript
const info = await trpc.onemap.tokenInfo.useQuery();
// Returns: { expiresAt: 1720000000, issuedAt: 1719600000 }
```

---

### `onemap.search` (Query)

**Purpose:** Search for locations (OneMap with HERE fallback)  
**Access:** Public  
**Input:**
```typescript
{
  q: string;           // Search query (min 1 char)
  page?: number;       // Pagination (optional)
}
```

**Output:**
```typescript
{
  results: Array<{
    id: string;
    title: string;
    address: string;
    lat: number;
    lng: number;
    source: 'onemap' | 'here';
  }>;
  hereFallback: Array<{
    id: string;
    title: string;
    address: { label: string; postalCode?: string };
    position: { lat: number; lng: number };
    source: 'here';
  }>;
}
```

**Logic:**
- If OneMap returns results → return them
- If OneMap returns 0 results AND HERE within cap → include HERE suggestions
- If HERE cap reached → return empty fallback

**Example:**
```typescript
const results = await trpc.onemap.search.useQuery({ q: 'Raffles Place' });
// Returns: { results: [...], hereFallback: [...] }
```

---

### `onemap.route` (Query)

**Purpose:** Calculate route between two points  
**Access:** Public  
**Input:**
```typescript
{
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  mode?: 'WALK' | 'TRANSIT' | 'DRIVE' | 'CYCLE';
  date?: string;  // Format: "YYYY-MM-DD"
  time?: string;  // Format: "HH:MM"
}
```

**Output:**
```typescript
{
  plan: {
    itineraries: Array<{
      duration: number;        // Total duration in seconds
      fare: number;            // Total fare in SGD
      legs: Array<{
        type: 'walk' | 'mrt' | 'bus';
        startPoint: { lat: number; lng: number };
        endPoint: { lat: number; lng: number };
        duration: number;       // Duration in seconds
        distance: number;       // Distance in meters
        
        // For walk legs
        polyline?: string;      // Encoded polyline
        
        // For MRT legs
        lineCode?: string;      // e.g., "NS"
        lineName?: string;      // e.g., "North-South Line"
        startStation?: string;
        endStation?: string;
        numStops?: number;
        
        // For bus legs
        busNo?: string;         // e.g., "175"
        startBusStop?: string;
        endBusStop?: string;
        busStopCode?: string;
        
        // Bus feasibility (Phase 12)
        busLegFeasibility?: {
          status: 'ok' | 'tight' | 'miss' | 'unknown';
          buffer: number;       // Minutes
          alternatives: Array<{
            serviceNo: string;
            eta: string;        // ISO timestamp
            feasibility: 'ok' | 'tight' | 'miss';
            buffer: number;
          }>;
        };
      }>;
    }>;
  };
}
```

**Example:**
```typescript
const route = await trpc.onemap.route.useQuery({
  start: { lat: 1.2833, lng: 103.8467 },  // Raffles Place
  end: { lat: 1.3521, lng: 103.8198 },    // Orchard
});
// Returns: { plan: { itineraries: [...] } }
```

---

### `onemap.forceRefreshToken` (Mutation)

**Purpose:** Manually refresh OneMap token  
**Access:** Protected (admin)  
**Input:**
```typescript
{
  email: string;
  password: string;
}
```

**Output:**
```typescript
{
  token: string;
  expiresAt: number;
}
```

**Example:**
```typescript
await trpc.onemap.forceRefreshToken.useMutation({
  email: 'user@onemap.sg',
  password: 'password123',
});
```

---

## LTA Router

### `lta.busArrivals` (Query)

**Purpose:** Get live bus arrivals at a stop  
**Access:** Public  
**Input:**
```typescript
{
  busStopCode: string;  // e.g., "01012"
  serviceNo?: string;   // Optional: filter by service number
}
```

**Output:**
```typescript
{
  busStopCode: string;
  services: Array<{
    serviceNo: string;
    nextBus: {
      estimatedArrival: string;  // ISO timestamp
      load: 'SEA' | 'SDA' | 'LDA';  // Seats available, Standing available, Limited
      type: 'SD' | 'DD' | 'BD';     // Single deck, Double deck, Bendy
      feature: string;              // e.g., "WAB" (Wheelchair accessible)
    };
    nextBus2?: { ... };
    nextBus3?: { ... };
  }>;
}
```

**Example:**
```typescript
const arrivals = await trpc.lta.busArrivals.useQuery({ busStopCode: '01012' });
// Returns: { busStopCode: '01012', services: [...] }
```

---

### `lta.busStops` (Query)

**Purpose:** Get all bus stops (cached, 24h TTL)  
**Access:** Public  
**Input:** None  
**Output:**
```typescript
Array<{
  BusStopCode: string;
  RoadName: string;
  Description: string;
  Latitude: number;
  Longitude: number;
}>
```

**Example:**
```typescript
const stops = await trpc.lta.busStops.useQuery();
// Returns: [{ BusStopCode: '01012', RoadName: 'Raffles Pl', ... }, ...]
```

---

### `lta.nearbyStops` (Query)

**Purpose:** Find bus stops near a location  
**Access:** Public  
**Input:**
```typescript
{
  lat: number;
  lng: number;
  radius?: number;  // Meters (default: 400)
}
```

**Output:**
```typescript
Array<{
  BusStopCode: string;
  RoadName: string;
  Description: string;
  Latitude: number;
  Longitude: number;
  distance: number;  // Distance in meters
}>
```

**Example:**
```typescript
const nearby = await trpc.lta.nearbyStops.useQuery({
  lat: 1.2833,
  lng: 103.8467,
  radius: 500,
});
```

---

## MRT Router

### `mrt.lineStatuses` (Query)

**Purpose:** Get all MRT line statuses  
**Access:** Public  
**Input:** None  
**Output:**
```typescript
Array<{
  lineCode: string;           // "NS", "EW", etc.
  status: 'operational' | 'disrupted' | 'suspended';
  message?: string;
  lastUpdated: string;        // ISO timestamp
}>
```

**Example:**
```typescript
const statuses = await trpc.mrt.lineStatuses.useQuery();
// Returns: [{ lineCode: 'NS', status: 'operational', ... }, ...]
```

---

### `mrt.operatingHours` (Query)

**Purpose:** Get MRT operating hours  
**Access:** Public  
**Input:**
```typescript
{
  lineCode?: string;  // Optional: specific line
}
```

**Output:**
```typescript
Array<{
  lineCode: string;
  firstTrain: string;      // "05:31"
  lastTrain: string;       // "23:42"
  frequency: string;       // "2-3 min"
}>
```

**Example:**
```typescript
const hours = await trpc.mrt.operatingHours.useQuery({ lineCode: 'NS' });
```

---

### `mrt.serviceAlerts` (Query)

**Purpose:** Get MRT service alerts  
**Access:** Public  
**Input:** None  
**Output:**
```typescript
Array<{
  lineCode: string;
  alert: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;  // ISO timestamp
}>
```

**Example:**
```typescript
const alerts = await trpc.mrt.serviceAlerts.useQuery();
```

---

## HERE Router

### `here.usageStats` (Query)

**Purpose:** Get HERE API monthly usage stats  
**Access:** Public  
**Input:** None  
**Output:**
```typescript
{
  used: number;       // Calls used this month
  cap: number;        // Monthly cap (29,950)
  remaining: number;  // Remaining calls
  available: boolean; // Is HERE available?
}
```

**Example:**
```typescript
const stats = await trpc.here.usageStats.useQuery();
// Returns: { used: 150, cap: 29950, remaining: 29800, available: true }
```

---

## Saved Locations Router

### `savedLocations.list` (Query)

**Purpose:** Get user's saved locations  
**Access:** Protected  
**Input:** None  
**Output:**
```typescript
Array<{
  id: number;
  label: string;
  address: string;
  lat: string;
  lng: string;
  createdAt: Date;
}>
```

**Example:**
```typescript
const locations = await trpc.savedLocations.list.useQuery();
```

---

### `savedLocations.add` (Mutation)

**Purpose:** Add a saved location  
**Access:** Protected  
**Input:**
```typescript
{
  label: string;      // Max 128 chars
  address: string;    // Max 255 chars
  lat: string;
  lng: string;
}
```

**Output:**
```typescript
{ success: true }
```

**Example:**
```typescript
await trpc.savedLocations.add.useMutation({
  label: 'Office',
  address: 'Raffles Place, Singapore',
  lat: '1.2833',
  lng: '103.8467',
});
```

---

### `savedLocations.rename` (Mutation)

**Purpose:** Rename a saved location  
**Access:** Protected  
**Input:**
```typescript
{
  id: number;
  label: string;  // New label
}
```

**Output:**
```typescript
{ success: true }
```

---

### `savedLocations.delete` (Mutation)

**Purpose:** Delete a saved location  
**Access:** Protected  
**Input:**
```typescript
{
  id: number;
}
```

**Output:**
```typescript
{ success: true }
```

---

## Favourite Routes Router

### `favouriteRoutes.list` (Query)

**Purpose:** Get user's favourite routes  
**Access:** Protected  
**Input:** None  
**Output:**
```typescript
Array<{
  id: number;
  label: string;
  origin: string;
  destination: string;
  createdAt: Date;
}>
```

---

### `favouriteRoutes.add` (Mutation)

**Purpose:** Add a favourite route  
**Access:** Protected  
**Input:**
```typescript
{
  label: string;        // Max 128 chars
  origin: string;       // Max 255 chars
  destination: string;  // Max 255 chars
}
```

**Output:**
```typescript
{ success: true }
```

---

### `favouriteRoutes.rename` (Mutation)

**Purpose:** Rename a favourite route  
**Access:** Protected  
**Input:**
```typescript
{
  id: number;
  label: string;
}
```

**Output:**
```typescript
{ success: true }
```

---

### `favouriteRoutes.delete` (Mutation)

**Purpose:** Delete a favourite route  
**Access:** Protected  
**Input:**
```typescript
{
  id: number;
}
```

**Output:**
```typescript
{ success: true }
```

---

## Settings Router

### `settings.get` (Query)

**Purpose:** Get a setting value  
**Access:** Protected  
**Input:**
```typescript
{
  key: string;
}
```

**Output:**
```typescript
{
  value: string | null;
}
```

---

### `settings.set` (Mutation)

**Purpose:** Set a setting value  
**Access:** Protected  
**Input:**
```typescript
{
  key: string;
  value: string;
}
```

**Output:**
```typescript
{ success: true }
```

---

## Error Handling

All procedures follow tRPC error conventions:

```typescript
// Invalid input
throw new TRPCError({
  code: 'BAD_REQUEST',
  message: 'Invalid input: query must be at least 1 character',
});

// Unauthorized
throw new TRPCError({
  code: 'UNAUTHORIZED',
  message: 'You must be logged in',
});

// Forbidden
throw new TRPCError({
  code: 'FORBIDDEN',
  message: 'You do not have permission to access this resource',
});

// Not found
throw new TRPCError({
  code: 'NOT_FOUND',
  message: 'Location not found',
});

// Server error
throw new TRPCError({
  code: 'INTERNAL_SERVER_ERROR',
  message: 'Failed to fetch route data',
});
```

---

## Rate Limiting

- **OneMap:** No public limit (generous)
- **LTA:** 500 calls/min
- **HERE:** 29,950 calls/month (enforced)
- **tRPC:** No built-in limit (implement if needed)

---

## Caching Strategy

- **Bus stops:** 24 hours (cached in memory + DB)
- **MRT statuses:** 1 hour (updated from LTA)
- **OneMap token:** In-memory + DB (refresh 6h before expiry)
- **HERE usage:** Per-call check (DB counter)
- **Route results:** No caching (real-time)

---

## Type Safety

All inputs validated with Zod:

```typescript
const searchInput = z.object({
  q: z.string().min(1).max(255),
  page: z.number().optional(),
});

const routeInput = z.object({
  start: z.object({ lat: z.number(), lng: z.number() }),
  end: z.object({ lat: z.number(), lng: z.number() }),
  mode: z.enum(['WALK', 'TRANSIT', 'DRIVE', 'CYCLE']).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});
```

---

## Testing

Each procedure should have tests:

```typescript
describe('onemap.route', () => {
  test('returns valid route', async () => {
    const result = await caller.onemap.route({
      start: { lat: 1.2833, lng: 103.8467 },
      end: { lat: 1.3521, lng: 103.8198 },
    });
    expect(result.plan.itineraries).toBeDefined();
  });

  test('throws on invalid input', async () => {
    await expect(
      caller.onemap.route({
        start: { lat: 'invalid', lng: 103.8467 },
        end: { lat: 1.3521, lng: 103.8198 },
      })
    ).rejects.toThrow();
  });
});
```
