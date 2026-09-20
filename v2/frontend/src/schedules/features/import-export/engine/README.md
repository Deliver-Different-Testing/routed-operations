# SmartDateParser - Universal Date/Time Parser

Intelligent date and time parser that handles multiple formats with ambiguity detection and confidence scoring.

## Features

- **12+ Date Formats**: ISO, US, EU, month names, and more
- **5+ Time Formats**: 24-hour, 12-hour with AM/PM
- **Ambiguity Detection**: Detects and flags ambiguous dates (e.g., 01/02/2024)
- **Confidence Scoring**: Returns 0-1 confidence scores for parsed values
- **Smart Normalization**: Handles whitespace, case insensitivity, common typos
- **Type-Safe**: Full TypeScript support with comprehensive interfaces

## Installation

```typescript
import { parseDate, parseTime, parseDateTime } from './SmartDateParser';
```

## API Reference

### `parseDate(input: string, preferredFormat?: 'US' | 'EU' | 'ISO'): DateParseResult`

Parses date strings in various formats.

**Supported Formats:**
1. `YYYY-MM-DD` (ISO) → confidence 1.0
2. `YYYY/MM/DD` → confidence 1.0
3. `MM/DD/YYYY` (US) → confidence 0.8-0.9
4. `DD/MM/YYYY` (EU) → confidence 0.8-0.9
5. `MM-DD-YYYY` → confidence 0.8-0.9
6. `DD-MM-YYYY` → confidence 0.8-0.9
7. `M/D/YYYY` (no leading zeros) → confidence 0.7-0.8
8. `D/M/YYYY` → confidence 0.7-0.9
9. `MMM DD, YYYY` (Jan 15, 2024) → confidence 0.9
10. `DD MMM YYYY` (15 Jan 2024) → confidence 0.9
11. `MMMM DD, YYYY` (January 15, 2024) → confidence 0.9
12. `YYYY-MM-DDTHH:mm:ss` (ISO datetime) → confidence 1.0

**Examples:**

```typescript
// ISO format (highest confidence)
parseDate('2024-01-15')
// { value: '2024-01-15', confidence: 1.0, originalFormat: 'YYYY-MM-DD', wasAmbiguous: false }

// US format with ambiguity
parseDate('01/02/2024', 'US')
// { value: '2024-01-02', confidence: 0.8, originalFormat: 'MM/DD/YYYY', wasAmbiguous: true }

// EU format
parseDate('15/01/2024', 'EU')
// { value: '2024-01-15', confidence: 0.9, originalFormat: 'DD/MM/YYYY', wasAmbiguous: false }

// Month names
parseDate('January 15, 2024')
// { value: '2024-01-15', confidence: 0.9, originalFormat: 'MMMM DD, YYYY', wasAmbiguous: false }

// Common typos handled
parseDate('Janury 15, 2024')
// { value: '2024-01-15', confidence: 0.9, originalFormat: 'MMMM DD, YYYY', wasAmbiguous: false }
```

### `parseTime(input: string): TimeParseResult`

Parses time strings in various formats.

**Supported Formats:**
1. `HH:mm` (24-hour) → confidence 1.0
2. `HH:mm:ss` → confidence 1.0
3. `h:mm a` (12-hour) → confidence 0.95
4. `h:mm:ss a` → confidence 0.95
5. `hh:mm a` (with leading zero) → confidence 0.95

**Examples:**

```typescript
// 24-hour format
parseTime('14:30')
// { value: '14:30:00', confidence: 1.0 }

// 12-hour with AM/PM
parseTime('2:30 PM')
// { value: '14:30:00', confidence: 0.95 }

parseTime('12:00 AM')
// { value: '00:00:00', confidence: 0.95 }

parseTime('12:00 PM')
// { value: '12:00:00', confidence: 0.95 }
```

### `parseDateTime(input: string, preferredFormat?: 'US' | 'EU' | 'ISO'): DateTimeParseResult`

Parses combined date and time strings.

**Examples:**

```typescript
// ISO datetime
parseDateTime('2024-01-15T14:30:00')
// {
//   date: '2024-01-15',
//   time: '14:30:00',
//   combined: '2024-01-15T14:30:00',
//   confidence: 1.0,
//   wasAmbiguous: false
// }

// Date and time with space
parseDateTime('2024-01-15 14:30:00')
// {
//   date: '2024-01-15',
//   time: '14:30:00',
//   combined: '2024-01-15T14:30:00',
//   confidence: 1.0,
//   wasAmbiguous: false
// }

// Month name with 12-hour time
parseDateTime('Jan 15, 2024 2:30 PM')
// {
//   date: '2024-01-15',
//   time: '14:30:00',
//   combined: '2024-01-15T14:30:00',
//   confidence: 0.9,
//   wasAmbiguous: false
// }

// Date only
parseDateTime('2024-01-15')
// {
//   date: '2024-01-15',
//   time: null,
//   combined: '2024-01-15',
//   confidence: 1.0,
//   wasAmbiguous: false
// }

// Time only
parseDateTime('14:30:00')
// {
//   date: null,
//   time: '14:30:00',
//   combined: null,
//   confidence: 1.0,
//   wasAmbiguous: false
// }
```

### `isValidDate(year: number, month: number, day: number): boolean`

Validates if a date is valid (accounting for leap years, days in month, etc.)

**Examples:**

```typescript
isValidDate(2024, 2, 29)  // true (leap year)
isValidDate(2023, 2, 29)  // false (not a leap year)
isValidDate(2024, 4, 31)  // false (April has 30 days)
isValidDate(2024, 13, 1)  // false (invalid month)
```

## Return Types

```typescript
interface DateParseResult {
  value: string | null;      // ISO format (YYYY-MM-DD) or null if unparseable
  confidence: number;        // 0-1 score
  originalFormat?: string;   // Detected format
  wasAmbiguous: boolean;     // e.g., 01/02/2024 could be Jan 2 or Feb 1
}

interface TimeParseResult {
  value: string | null;      // HH:mm:ss format or null
  confidence: number;
}

interface DateTimeParseResult {
  date: string | null;       // YYYY-MM-DD
  time: string | null;       // HH:mm:ss
  combined: string | null;   // ISO datetime (YYYY-MM-DDTHH:mm:ss)
  confidence: number;
  wasAmbiguous: boolean;
}
```

## Ambiguity Handling

When a date like `01/02/2024` is encountered, it could mean:
- **US format**: January 2, 2024 (MM/DD/YYYY)
- **EU format**: February 1, 2024 (DD/MM/YYYY)

The parser handles this by:
1. Using the `preferredFormat` parameter (defaults to 'US')
2. Setting `wasAmbiguous: true` when both interpretations are valid
3. Returning lower confidence (0.8) for ambiguous dates

**Example:**

```typescript
parseDate('01/02/2024', 'US')
// { value: '2024-01-02', wasAmbiguous: true, confidence: 0.8 }

parseDate('01/02/2024', 'EU')
// { value: '2024-02-01', wasAmbiguous: true, confidence: 0.8 }

parseDate('01/15/2024', 'US')
// { value: '2024-01-15', wasAmbiguous: false, confidence: 0.9 }
// Not ambiguous because 15 cannot be a month
```

## Smart Features

### Case Insensitivity
```typescript
parseDate('JANUARY 15, 2024')  // Works
parseDate('january 15, 2024')  // Works
parseDate('JaNuArY 15, 2024')  // Works
```

### Common Typos
```typescript
parseDate('Janury 15, 2024')     // → January
parseDate('Feburary 15, 2024')   // → February
parseDate('Decemeber 15, 2024')  // → December
```

### Separator Normalization
```typescript
parseDate('01/15/2024')  // Slash
parseDate('01-15-2024')  // Hyphen
parseDate('01.15.2024')  // Dot
// All work the same way
```

### Whitespace Handling
```typescript
parseDate('  2024-01-15  ')  // Trimmed automatically
parseDate('Jan  15,  2024')  // Extra spaces handled
```

## Testing

Run the comprehensive test suite:

```bash
npx tsx src/features/import-export/engine/test-runner.ts
```

Tests cover:
- All 12 date formats
- All 5 time formats
- Ambiguity detection
- Edge cases (leap years, invalid dates)
- Case insensitivity
- Common typos
- Combined date/time parsing

## Use Cases

Perfect for:
- CSV/Excel import systems
- Data migration tools
- Form input validation
- API date normalization
- Multi-locale applications
- Legacy data cleanup

## Performance

- Zero dependencies (pure TypeScript)
- Regex-based parsing (fast)
- No date libraries required
- Works in browser and Node.js
