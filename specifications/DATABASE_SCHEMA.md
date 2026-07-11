# Ripple Transit — Database Schema Specification

**Database:** MySQL/TiDB  
**ORM:** Drizzle  
**Total Tables:** 6  

---

## Table 1: `users`

**Purpose:** Store user accounts and authentication data

```sql
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) UNIQUE NOT NULL,
  role ENUM('user', 'admin') DEFAULT 'user',
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**Drizzle Schema:**
```typescript
export const users = mysqlTable('users', {
  id: int().primaryKey().autoincrement(),
  email: varchar(255).unique().notNull(),
  role: mysqlEnum('role', ['user', 'admin']).default('user'),
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow().onUpdateNow(),
});
```

**Fields:**
- `id` — Unique user identifier
- `email` — User email (unique)
- `role` — User role (user or admin)
- `createdAt` — Account creation timestamp
- `updatedAt` — Last update timestamp

**Indexes:**
- PRIMARY KEY on `id`
- UNIQUE on `email`

---

## Table 2: `savedLocations`

**Purpose:** Store user's saved locations (home, office, etc.)

```sql
CREATE TABLE savedLocations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  userId INT NOT NULL,
  label VARCHAR(128) NOT NULL,
  address VARCHAR(255) NOT NULL,
  lat VARCHAR(20) NOT NULL,
  lng VARCHAR(20) NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_label (userId, label)
);
```

**Drizzle Schema:**
```typescript
export const savedLocations = mysqlTable('savedLocations', {
  id: int().primaryKey().autoincrement(),
  userId: int().notNull().references(() => users.id, { onDelete: 'cascade' }),
  label: varchar(128).notNull(),
  address: varchar(255).notNull(),
  lat: varchar(20).notNull(),
  lng: varchar(20).notNull(),
  createdAt: timestamp().defaultNow(),
}, (table) => ({
  userLabelIdx: uniqueIndex('unique_user_label').on(table.userId, table.label),
}));
```

**Fields:**
- `id` — Unique location identifier
- `userId` — Foreign key to user
- `label` — User-friendly name (e.g., "Home", "Office")
- `address` — Full address string
- `lat` — Latitude coordinate
- `lng` — Longitude coordinate
- `createdAt` — Creation timestamp

**Constraints:**
- Foreign key to `users(id)` with CASCADE delete
- Unique constraint on (userId, label) — user can't have duplicate labels

---

## Table 3: `favouriteRoutes`

**Purpose:** Store user's frequently used routes

```sql
CREATE TABLE favouriteRoutes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  userId INT NOT NULL,
  label VARCHAR(128) NOT NULL,
  origin VARCHAR(255) NOT NULL,
  destination VARCHAR(255) NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_route_label (userId, label)
);
```

**Drizzle Schema:**
```typescript
export const favouriteRoutes = mysqlTable('favouriteRoutes', {
  id: int().primaryKey().autoincrement(),
  userId: int().notNull().references(() => users.id, { onDelete: 'cascade' }),
  label: varchar(128).notNull(),
  origin: varchar(255).notNull(),
  destination: varchar(255).notNull(),
  createdAt: timestamp().defaultNow(),
}, (table) => ({
  userRouteLabelIdx: uniqueIndex('unique_user_route_label').on(table.userId, table.label),
}));
```

**Fields:**
- `id` — Unique route identifier
- `userId` — Foreign key to user
- `label` — User-friendly name (e.g., "Home to Office")
- `origin` — Starting location
- `destination` — Ending location
- `createdAt` — Creation timestamp

**Constraints:**
- Foreign key to `users(id)` with CASCADE delete
- Unique constraint on (userId, label)

---

## Table 4: `apiUsageCounters`

**Purpose:** Track monthly API usage for rate-limited services (HERE)

```sql
CREATE TABLE apiUsageCounters (
  service VARCHAR(50) NOT NULL,
  month VARCHAR(7) NOT NULL,
  count INT DEFAULT 0,
  PRIMARY KEY (service, month)
);
```

**Drizzle Schema:**
```typescript
export const apiUsageCounters = mysqlTable('apiUsageCounters', {
  service: varchar(50).notNull(),
  month: varchar(7).notNull(), // Format: "YYYY-MM"
  count: int().default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.service, table.month] }),
}));
```

**Fields:**
- `service` — Service name (e.g., "here")
- `month` — Month in "YYYY-MM" format (UTC)
- `count` — Number of API calls this month

**Constraints:**
- Composite primary key on (service, month)

**Usage:**
- HERE API: 29,950 calls/month cap
- Counter resets automatically on month boundary
- Incremented before each API call

---

## Table 5: `cachedTokens`

**Purpose:** Cache authentication tokens for external services

```sql
CREATE TABLE cachedTokens (
  service VARCHAR(50) PRIMARY KEY,
  token LONGTEXT NOT NULL,
  expiresAt INT NOT NULL,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**Drizzle Schema:**
```typescript
export const cachedTokens = mysqlTable('cachedTokens', {
  service: varchar(50).primaryKey(),
  token: text().notNull(),
  expiresAt: int().notNull(), // Unix timestamp (seconds)
  updatedAt: timestamp().defaultNow().onUpdateNow(),
});
```

**Fields:**
- `service` — Service name (e.g., "onemap")
- `token` — Authentication token (JWT)
- `expiresAt` — Expiration timestamp (Unix seconds)
- `updatedAt` — Last update timestamp

**Usage:**
- OneMap: 3-day JWT tokens
- Auto-refresh 6 hours before expiry
- Fallback to environment variable if refresh fails

---

## Table 6: `mrtLineStatuses`

**Purpose:** Cache MRT line operational statuses

```sql
CREATE TABLE mrtLineStatuses (
  lineCode VARCHAR(10) PRIMARY KEY,
  status ENUM('operational', 'disrupted', 'suspended') DEFAULT 'operational',
  message TEXT,
  lastUpdated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**Drizzle Schema:**
```typescript
export const mrtLineStatuses = mysqlTable('mrtLineStatuses', {
  lineCode: varchar(10).primaryKey(), // e.g., "NS", "EW", "CC"
  status: mysqlEnum('status', ['operational', 'disrupted', 'suspended']).default('operational'),
  message: text(),
  lastUpdated: timestamp().defaultNow().onUpdateNow(),
});
```

**Fields:**
- `lineCode` — MRT line code (NS, EW, CC, NE, DT, TE, etc.)
- `status` — Current operational status
- `message` — Additional status message (e.g., "Minor delays")
- `lastUpdated` — Last status update time

**Usage:**
- Updated hourly from LTA API
- Displayed in UI for user awareness
- Used for route validation

---

## Table 7: `settings` (Optional, for future use)

**Purpose:** Store user and system settings

```sql
CREATE TABLE settings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  userId INT,
  key VARCHAR(100) NOT NULL,
  value TEXT,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_setting (userId, key)
);
```

**Drizzle Schema:**
```typescript
export const settings = mysqlTable('settings', {
  id: int().primaryKey().autoincrement(),
  userId: int().references(() => users.id, { onDelete: 'cascade' }),
  key: varchar(100).notNull(),
  value: text(),
}, (table) => ({
  userSettingIdx: uniqueIndex('unique_user_setting').on(table.userId, table.key),
}));
```

**Usage:**
- Store OneMap credentials (email, password)
- Store user preferences (theme, language, etc.)
- System settings (API keys, configuration)

---

## Relationships Diagram

```
users (1)
  ├── (1:N) savedLocations
  ├── (1:N) favouriteRoutes
  └── (1:N) settings

apiUsageCounters (independent)
  └── Tracks HERE API usage per month

cachedTokens (independent)
  └── Caches OneMap JWT tokens

mrtLineStatuses (independent)
  └── Caches MRT line statuses
```

---

## Migration Strategy

### **Initial Setup**
```sql
-- Create all tables
CREATE TABLE users (...);
CREATE TABLE savedLocations (...);
CREATE TABLE favouriteRoutes (...);
CREATE TABLE apiUsageCounters (...);
CREATE TABLE cachedTokens (...);
CREATE TABLE mrtLineStatuses (...);
```

### **Drizzle Workflow**
1. Define schema in `drizzle/schema.ts`
2. Run `pnpm drizzle-kit generate` to create migration SQL
3. Review generated migration file
4. Apply via `webdev_execute_sql` tool

### **Seed Data**
```sql
-- Insert MRT line statuses
INSERT INTO mrtLineStatuses (lineCode, status) VALUES
  ('NS', 'operational'),
  ('EW', 'operational'),
  ('CC', 'operational'),
  ('NE', 'operational'),
  ('DT', 'operational'),
  ('TE', 'operational');
```

---

## Database Helpers (server/db.ts)

### **User Operations**
```typescript
export async function getUserById(id: number)
export async function getUserByEmail(email: string)
export async function createUser(email: string, role: 'user' | 'admin')
```

### **Saved Locations**
```typescript
export async function getSavedLocations(userId: number)
export async function addSavedLocation(userId: number, label: string, address: string, lat: string, lng: string)
export async function updateSavedLocationLabel(id: number, label: string)
export async function deleteSavedLocation(id: number)
```

### **Favourite Routes**
```typescript
export async function listFavouriteRoutes(userId: number)
export async function addFavouriteRoute(userId: number, label: string, origin: string, destination: string)
export async function renameFavouriteRoute(id: number, label: string)
export async function deleteFavouriteRoute(id: number)
```

### **API Usage**
```typescript
export async function getApiUsageCount(service: string): Promise<number>
export async function incrementApiUsage(service: string): Promise<number>
```

### **Token Caching**
```typescript
export async function getCachedToken(service: string)
export async function upsertCachedToken(service: string, token: string, expiresAt: number)
```

### **MRT Status**
```typescript
export async function getMrtLineStatus(lineCode: string)
export async function updateMrtLineStatus(lineCode: string, status: string, message?: string)
export async function getAllLineStatuses()
```

### **Settings**
```typescript
export async function getSetting(key: string): Promise<string | null>
export async function setSetting(key: string, value: string)
export async function getAllSettings(): Promise<Record<string, string>>
```

---

## Performance Considerations

### **Indexes**
- Primary keys on all tables
- Foreign keys indexed automatically
- Unique constraints on (userId, label) for deduplication
- Consider adding index on `createdAt` for sorting

### **Query Optimization**
- Use `SELECT * FROM savedLocations WHERE userId = ?` for user-specific queries
- Batch operations where possible
- Use connection pooling

### **Caching Strategy**
- In-memory cache for tokens (refresh every 1 hour)
- Database cache for tokens (persistent)
- MRT statuses updated hourly
- API usage counters checked before each call

---

## Data Retention

- **User data:** Keep indefinitely (or until user deletion)
- **API usage counters:** Keep for 12 months (for analytics)
- **Cached tokens:** Keep until expiry, then delete
- **MRT statuses:** Keep current only, update hourly

---

## Security Considerations

- Passwords stored in settings (encrypted in production)
- API keys stored in environment variables (not database)
- User data isolated by userId (no cross-user access)
- Foreign key constraints prevent orphaned records

---

## Scaling Considerations

- Partition `apiUsageCounters` by month for large deployments
- Archive old `apiUsageCounters` records after 12 months
- Consider read replicas for high-traffic queries
- Monitor query performance on `savedLocations` and `favouriteRoutes`
