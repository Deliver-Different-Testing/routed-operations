/**
 * SmartDateParser - Intelligent date/time parser supporting multiple formats
 * Handles ambiguity detection, format confidence scoring, and smart normalization
 */

export interface DateParseResult {
  value: string | null;      // ISO format (YYYY-MM-DD) or null if unparseable
  confidence: number;        // 0-1 score
  originalFormat?: string;   // Detected format
  wasAmbiguous: boolean;     // e.g., 01/02/2024 could be Jan 2 or Feb 1
}

export interface TimeParseResult {
  value: string | null;      // HH:mm:ss format or null
  confidence: number;
}

export interface DateTimeParseResult {
  date: string | null;       // YYYY-MM-DD
  time: string | null;       // HH:mm:ss
  combined: string | null;   // ISO datetime
  confidence: number;
  wasAmbiguous: boolean;
}

type PreferredFormat = 'US' | 'EU' | 'ISO';

// Month name mappings with common typos
const MONTH_NAMES: Record<string, number> = {
  // Full names
  'january': 1, 'february': 2, 'march': 3, 'april': 4,
  'may': 5, 'june': 6, 'july': 7, 'august': 8,
  'september': 9, 'october': 10, 'november': 11, 'december': 12,
  // Abbreviated
  'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
  'jun': 6, 'jul': 7, 'aug': 8, 'sep': 9, 'sept': 9,
  'oct': 10, 'nov': 11, 'dec': 12,
  // Common typos
  'janury': 1, 'januray': 1, 'feburary': 2, 'febuary': 2,
  'ocotber': 10, 'decemeber': 12, 'decembre': 12,
};

/**
 * Validates if a date is valid (accounting for leap years, etc.)
 */
export function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;

  // Days in each month
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  // Check for leap year
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  if (month === 2 && isLeapYear) {
    return day <= 29;
  }

  return day <= daysInMonth[month - 1];
}

/**
 * Parses time strings in various formats
 */
export function parseTime(input: string): TimeParseResult {
  if (!input) {
    return { value: null, confidence: 0 };
  }

  const trimmed = input.trim();

  // Pattern 1: HH:mm or HH:mm:ss (24-hour)
  const time24Match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (time24Match) {
    const hours = parseInt(time24Match[1], 10);
    const minutes = parseInt(time24Match[2], 10);
    const seconds = time24Match[3] ? parseInt(time24Match[3], 10) : 0;

    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59) {
      const hh = hours.toString().padStart(2, '0');
      const mm = minutes.toString().padStart(2, '0');
      const ss = seconds.toString().padStart(2, '0');
      return { value: `${hh}:${mm}:${ss}`, confidence: 1.0 };
    }
  }

  // Pattern 2: h:mm a or hh:mm a (12-hour with AM/PM)
  const time12Match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)$/i);
  if (time12Match) {
    let hours = parseInt(time12Match[1], 10);
    const minutes = parseInt(time12Match[2], 10);
    const seconds = time12Match[3] ? parseInt(time12Match[3], 10) : 0;
    const period = time12Match[4].toLowerCase().replace(/\./g, '');

    if (hours >= 1 && hours <= 12 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59) {
      // Convert to 24-hour
      if (period === 'pm' || period === 'pm') {
        if (hours !== 12) hours += 12;
      } else if (period === 'am' || period === 'am') {
        if (hours === 12) hours = 0;
      }

      const hh = hours.toString().padStart(2, '0');
      const mm = minutes.toString().padStart(2, '0');
      const ss = seconds.toString().padStart(2, '0');
      return { value: `${hh}:${mm}:${ss}`, confidence: 0.95 };
    }
  }

  return { value: null, confidence: 0 };
}

/**
 * Attempts to parse month name (handling typos)
 */
function parseMonthName(monthStr: string): number | null {
  const normalized = monthStr.toLowerCase().trim();
  return MONTH_NAMES[normalized] || null;
}

/**
 * Main date parser - handles multiple formats with ambiguity detection
 */
export function parseDate(input: string, preferredFormat: PreferredFormat = 'US'): DateParseResult {
  if (!input) {
    return { value: null, confidence: 0, wasAmbiguous: false };
  }

  const trimmed = input.trim();

  // Pattern 1: ISO format YYYY-MM-DD or YYYY/MM/DD (highest confidence)
  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);

    if (isValidDate(year, month, day)) {
      const mm = month.toString().padStart(2, '0');
      const dd = day.toString().padStart(2, '0');
      return {
        value: `${year}-${mm}-${dd}`,
        confidence: 1.0,
        originalFormat: trimmed.includes('/') ? 'YYYY/MM/DD' : 'YYYY-MM-DD',
        wasAmbiguous: false,
      };
    }
  }

  // Pattern 2: ISO datetime YYYY-MM-DDTHH:mm:ss
  const isoDateTimeMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (isoDateTimeMatch) {
    const year = parseInt(isoDateTimeMatch[1], 10);
    const month = parseInt(isoDateTimeMatch[2], 10);
    const day = parseInt(isoDateTimeMatch[3], 10);

    if (isValidDate(year, month, day)) {
      const mm = month.toString().padStart(2, '0');
      const dd = day.toString().padStart(2, '0');
      return {
        value: `${year}-${mm}-${dd}`,
        confidence: 1.0,
        originalFormat: 'YYYY-MM-DDTHH:mm:ss',
        wasAmbiguous: false,
      };
    }
  }

  // Pattern 3: MM/DD/YYYY or DD/MM/YYYY (ambiguous)
  const slashMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (slashMatch) {
    const part1 = parseInt(slashMatch[1], 10);
    const part2 = parseInt(slashMatch[2], 10);
    const year = parseInt(slashMatch[3], 10);

    // Determine if ambiguous (both parts could be valid months)
    const isAmbiguous = part1 <= 12 && part2 <= 12 && part1 !== part2;

    let month: number, day: number;
    let format: string;

    if (preferredFormat === 'EU') {
      // DD/MM/YYYY
      day = part1;
      month = part2;
      format = 'DD/MM/YYYY';
    } else {
      // US: MM/DD/YYYY (default)
      month = part1;
      day = part2;
      format = 'MM/DD/YYYY';
    }

    if (isValidDate(year, month, day)) {
      const mm = month.toString().padStart(2, '0');
      const dd = day.toString().padStart(2, '0');
      return {
        value: `${year}-${mm}-${dd}`,
        confidence: isAmbiguous ? 0.8 : 0.9,
        originalFormat: format,
        wasAmbiguous: isAmbiguous,
      };
    }

    // Try the other interpretation if first failed
    if (preferredFormat === 'EU') {
      month = part1;
      day = part2;
      format = 'MM/DD/YYYY';
    } else {
      day = part1;
      month = part2;
      format = 'DD/MM/YYYY';
    }

    if (isValidDate(year, month, day)) {
      const mm = month.toString().padStart(2, '0');
      const dd = day.toString().padStart(2, '0');
      return {
        value: `${year}-${mm}-${dd}`,
        confidence: 0.7,
        originalFormat: format,
        wasAmbiguous: true,
      };
    }
  }

  // Pattern 4 & 6: Month name formats (check full names first, then abbreviated)
  const monthNameCommaMatch = trimmed.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (monthNameCommaMatch) {
    const monthName = monthNameCommaMatch[1];
    const day = parseInt(monthNameCommaMatch[2], 10);
    const year = parseInt(monthNameCommaMatch[3], 10);
    const month = parseMonthName(monthName);

    if (month && isValidDate(year, month, day)) {
      const mm = month.toString().padStart(2, '0');
      const dd = day.toString().padStart(2, '0');
      // Determine if it's a full month name or abbreviated
      const isFullMonth = monthName.toLowerCase().length > 3;
      return {
        value: `${year}-${mm}-${dd}`,
        confidence: 0.9,
        originalFormat: isFullMonth ? 'MMMM DD, YYYY' : 'MMM DD, YYYY',
        wasAmbiguous: false,
      };
    }
  }

  // Pattern 5: DD MMM YYYY (15 Jan 2024)
  const dayMonthYearMatch = trimmed.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i);
  if (dayMonthYearMatch) {
    const day = parseInt(dayMonthYearMatch[1], 10);
    const monthName = dayMonthYearMatch[2];
    const year = parseInt(dayMonthYearMatch[3], 10);
    const month = parseMonthName(monthName);

    if (month && isValidDate(year, month, day)) {
      const mm = month.toString().padStart(2, '0');
      const dd = day.toString().padStart(2, '0');
      return {
        value: `${year}-${mm}-${dd}`,
        confidence: 0.9,
        originalFormat: 'DD MMM YYYY',
        wasAmbiguous: false,
      };
    }
  }

  // Pattern 7: M/D/YYYY or D/M/YYYY (single digit month/day)
  const singleDigitMatch = trimmed.match(/^(\d{1})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (singleDigitMatch) {
    const part1 = parseInt(singleDigitMatch[1], 10);
    const part2 = parseInt(singleDigitMatch[2], 10);
    const year = parseInt(singleDigitMatch[3], 10);

    const isAmbiguous = part1 <= 12 && part2 <= 12 && part1 !== part2;

    let month: number, day: number;
    let format: string;

    if (preferredFormat === 'EU') {
      day = part1;
      month = part2;
      format = 'D/M/YYYY';
    } else {
      month = part1;
      day = part2;
      format = 'M/D/YYYY';
    }

    if (isValidDate(year, month, day)) {
      const mm = month.toString().padStart(2, '0');
      const dd = day.toString().padStart(2, '0');
      return {
        value: `${year}-${mm}-${dd}`,
        confidence: 0.7,
        originalFormat: format,
        wasAmbiguous: isAmbiguous,
      };
    }
  }

  // Failed to parse
  return {
    value: null,
    confidence: 0,
    wasAmbiguous: false,
  };
}

/**
 * Parses combined date and time strings
 */
export function parseDateTime(input: string, preferredFormat: PreferredFormat = 'US'): DateTimeParseResult {
  if (!input) {
    return {
      date: null,
      time: null,
      combined: null,
      confidence: 0,
      wasAmbiguous: false,
    };
  }

  const trimmed = input.trim();

  // Try to split on common separators
  // Pattern 1: ISO datetime (YYYY-MM-DDTHH:mm:ss)
  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  if (isoMatch) {
    const dateStr = isoMatch[1];
    const timeStr = isoMatch[2];

    const dateResult = parseDate(dateStr, preferredFormat);
    const timeResult = parseTime(timeStr);

    if (dateResult.value && timeResult.value) {
      return {
        date: dateResult.value,
        time: timeResult.value,
        combined: `${dateResult.value}T${timeResult.value}`,
        confidence: Math.min(dateResult.confidence, timeResult.confidence),
        wasAmbiguous: dateResult.wasAmbiguous,
      };
    }
  }

  // Pattern 2: Date and time separated by space or comma
  // Try to find time with AM/PM first (may need last 2 parts: "2:30 PM")
  const spaceSplit = trimmed.split(/[\s,]+/).filter(s => s.length > 0);
  if (spaceSplit.length >= 2) {
    // Check if last 2 parts form a valid time (e.g., "2:30" + "PM")
    if (spaceSplit.length >= 2) {
      const lastTwo = `${spaceSplit[spaceSplit.length - 2]} ${spaceSplit[spaceSplit.length - 1]}`;
      const timeResult = parseTime(lastTwo);
      if (timeResult.value) {
        const datePart = spaceSplit.slice(0, -2).join(' ');
        const dateResult = parseDate(datePart, preferredFormat);
        if (dateResult.value) {
          return {
            date: dateResult.value,
            time: timeResult.value,
            combined: `${dateResult.value}T${timeResult.value}`,
            confidence: Math.min(dateResult.confidence, timeResult.confidence),
            wasAmbiguous: dateResult.wasAmbiguous,
          };
        }
      }
    }

    // Try last part as time
    const timePart = spaceSplit[spaceSplit.length - 1];
    const datePart = spaceSplit.slice(0, -1).join(' ');

    const timeResult = parseTime(timePart);
    if (timeResult.value) {
      const dateResult = parseDate(datePart, preferredFormat);
      if (dateResult.value) {
        return {
          date: dateResult.value,
          time: timeResult.value,
          combined: `${dateResult.value}T${timeResult.value}`,
          confidence: Math.min(dateResult.confidence, timeResult.confidence),
          wasAmbiguous: dateResult.wasAmbiguous,
        };
      }
    }

    // Try first part as time (less common but possible)
    const firstTimePart = spaceSplit[0];
    const restDatePart = spaceSplit.slice(1).join(' ');

    const firstTimeResult = parseTime(firstTimePart);
    if (firstTimeResult.value) {
      const restDateResult = parseDate(restDatePart, preferredFormat);
      if (restDateResult.value) {
        return {
          date: restDateResult.value,
          time: firstTimeResult.value,
          combined: `${restDateResult.value}T${firstTimeResult.value}`,
          confidence: Math.min(restDateResult.confidence, firstTimeResult.confidence) * 0.9,
          wasAmbiguous: restDateResult.wasAmbiguous,
        };
      }
    }
  }

  // Try parsing as just a date
  const dateResult = parseDate(trimmed, preferredFormat);
  if (dateResult.value) {
    return {
      date: dateResult.value,
      time: null,
      combined: dateResult.value,
      confidence: dateResult.confidence,
      wasAmbiguous: dateResult.wasAmbiguous,
    };
  }

  // Try parsing as just a time
  const timeResult = parseTime(trimmed);
  if (timeResult.value) {
    return {
      date: null,
      time: timeResult.value,
      combined: null,
      confidence: timeResult.confidence,
      wasAmbiguous: false,
    };
  }

  // Failed to parse
  return {
    date: null,
    time: null,
    combined: null,
    confidence: 0,
    wasAmbiguous: false,
  };
}
