import { promisify } from "util";
import { exec } from "child_process";
import { CalendarCache } from "../cache/database.js";

const execAsync = promisify(exec);

export interface CalendarEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  location?: string;
  description?: string;
  calendarName: string;
  isAllDay: boolean;
}

export class RobustCalendarClient {
  private readonly DEFAULT_TIMEOUT = 120000; // 120 seconds
  private readonly SEARCH_TIMEOUT = 180000; // 180 seconds for search operations
  private cache: CalendarCache;
  
  constructor() {
    this.cache = new CalendarCache();
  }
  
  private getTimeout(operation: 'list' | 'get' | 'search' = 'list'): number {
    const envTimeout = process.env.MCP_CALENDAR_TIMEOUT;
    if (envTimeout) {
      return parseInt(envTimeout, 10);
    }
    
    switch (operation) {
      case 'search':
        return this.SEARCH_TIMEOUT;
      case 'list':
      case 'get':
      default:
        return this.DEFAULT_TIMEOUT;
    }
  }

  private async runAppleScript(script: string, operation: 'list' | 'get' | 'search' = 'list'): Promise<string> {
    try {
      const scriptContent = script.replace(/'/g, "'\"'\"'");
      const timeout = this.getTimeout(operation);
      
      const { stdout, stderr } = await execAsync(`osascript -e '${scriptContent}'`, {
        timeout
      });
      if (stderr) {
        throw new Error(`AppleScript error: ${stderr}`);
      }
      return stdout.trim();
    } catch (error: any) {
      if (error.killed && error.signal === 'SIGTERM') {
        throw new Error(`Calendar operation timed out after ${this.getTimeout(operation) / 1000}s. Try using a specific calendar name or smaller date range.`);
      }
      throw new Error(`Failed to execute AppleScript: ${error.message || error}`);
    }
  }

  async listEvents(
    startDate: string,
    endDate: string,
    calendarName?: string
  ): Promise<CalendarEvent[]> {
    // Try cache first
    const cachedEvents = await this.cache.getCachedEvents(calendarName, startDate, endDate);
    if (cachedEvents !== null) {
      console.error(`Calendar cache hit: ${cachedEvents.length} events found`);
      return cachedEvents;
    }
    
    console.error(`Calendar cache miss: fetching from AppleScript`);
    
    // Parse ISO date strings to create AppleScript date
    const startParts = startDate.split('-');
    const endParts = endDate.split('-');
    
    // More robust script with individual error handling for each event
    const script = `
      set startYear to ${startParts[0]}
      set startMonth to ${startParts[1]}
      set startDay to ${startParts[2]}
      set startDate to current date
      set year of startDate to startYear
      set month of startDate to startMonth
      set day of startDate to startDay
      set time of startDate to 0
      
      set endYear to ${endParts[0]}
      set endMonth to ${endParts[1]}
      set endDay to ${endParts[2]}
      set endDate to current date
      set year of endDate to endYear
      set month of endDate to endMonth
      set day of endDate to endDay
      set time of endDate to 23 * hours + 59 * minutes + 59
      
      set output to ""
      set processedCount to 0
      set errorCount to 0
      
      tell application "Calendar"
        ${calendarName ? `
        try
          set targetCalendar to calendar "${calendarName}"
          set allEvents to events of targetCalendar
          
          repeat with evt in allEvents
            try
              if (start date of evt >= startDate) and (start date of evt <= endDate) then
                set processedCount to processedCount + 1
                
                -- Get each property with individual error handling
                set eventId to "UNKNOWN_ID"
                try
                  set eventId to uid of evt
                end try
                
                set eventTitle to "Untitled Event"
                try
                  set eventTitle to summary of evt
                end try
                
                set eventStart to ""
                try
                  set eventStart to (start date of evt) as string
                on error
                  set eventStart to "Invalid Date"
                end try
                
                set eventEnd to ""
                try
                  set eventEnd to (end date of evt) as string
                on error
                  set eventEnd to eventStart
                end try
                
                set eventAllDay to "false"
                try
                  set eventAllDay to (allday event of evt) as string
                end try
                
                set eventLocation to ""
                try
                  set eventLocation to location of evt
                end try
                
                set eventDescription to ""
                try
                  set eventDescription to description of evt
                end try
                
                set output to output & eventId & "|" & eventTitle & "|" & eventStart & "|" & eventEnd & "|" & eventLocation & "|" & eventDescription & "|" & "${calendarName}" & "|" & eventAllDay & "\\n"
              end if
            on error errMsg
              set errorCount to errorCount + 1
            end try
          end repeat
        on error errMsg
          return "ERROR: Cannot access calendar ${calendarName}: " & errMsg
        end try` : 
        `set maxCalendarsToCheck to 10
        set calendarCount to 0
        repeat with cal in calendars
          if calendarCount < maxCalendarsToCheck then
            set calendarCount to calendarCount + 1
            try
              set calName to name of cal
              set calEvents to (events of cal whose start date >= startDate and start date <= endDate)
              
              repeat with evt in calEvents
                try
                  set processedCount to processedCount + 1
                  
                  -- Get each property with individual error handling
                  set eventId to "UNKNOWN_ID"
                  try
                    set eventId to uid of evt
                  end try
                  
                  set eventTitle to "Untitled Event"
                  try
                    set eventTitle to summary of evt
                  end try
                  
                  set eventStart to ""
                  try
                    set eventStart to (start date of evt) as string
                  on error
                    set eventStart to "Invalid Date"
                  end try
                  
                  set eventEnd to ""
                  try
                    set eventEnd to (end date of evt) as string
                  on error
                    set eventEnd to eventStart
                  end try
                  
                  set eventAllDay to "false"
                  try
                    set eventAllDay to (allday event of evt) as string
                  end try
                  
                  set eventLocation to ""
                  try
                    set eventLocation to location of evt
                  end try
                  
                  set eventDescription to ""
                  try
                    set eventDescription to description of evt
                  end try
                  
                  set output to output & eventId & "|" & eventTitle & "|" & eventStart & "|" & eventEnd & "|" & eventLocation & "|" & eventDescription & "|" & calName & "|" & eventAllDay & "\\n"
                on error errMsg
                  set errorCount to errorCount + 1
                end try
              end repeat
            on error
              -- Skip calendars that cause errors
            end try
          end if
        end repeat`}
        
        return output
      end tell
    `;

    const result = await this.runAppleScript(script, 'list');
    
    // Check for error message
    if (result.startsWith("ERROR:")) {
      throw new Error(result);
    }
    
    if (!result) return [];

    const events = result.split("\n").filter(line => line.trim()).map(line => {
      const [id, title, startDate, endDate, location, description, calendarName, isAllDay] = line.split("|");
      
      // Validate required fields
      if (!id || id === "UNKNOWN_ID" || !title || startDate === "Invalid Date" || !calendarName) {
        return null;
      }
      
      return {
        id,
        title,
        startDate,
        endDate: endDate || startDate,
        location: location || undefined,
        description: description || undefined,
        calendarName: calendarName || "Unknown Calendar",
        isAllDay: isAllDay === "true",
      };
    }).filter(event => event !== null) as CalendarEvent[];

    // Cache the results
    if (events.length > 0) {
      await this.cache.cacheEvents(events, calendarName);
    }

    return events;
  }

  async getCalendars(): Promise<string[]> {
    // Try cache first
    const cachedCalendars = await this.cache.getCachedCalendars();
    if (cachedCalendars !== null) {
      console.error(`Calendar cache hit: ${cachedCalendars.length} calendars found`);
      return cachedCalendars.map(c => c.name);
    }

    console.error(`Calendar cache miss: fetching calendars from AppleScript`);
    const script = `tell application "Calendar" to return name of calendars`;
    const result = await this.runAppleScript(script, 'list');
    
    if (!result) return [];
    
    const calendars = result.split(', ').map(name => name.trim());
    
    // Cache the calendar list
    await this.cache.cacheCalendars(calendars);
    
    return calendars;
  }

  // Cleanup method
  close(): void {
    this.cache.close();
  }
}