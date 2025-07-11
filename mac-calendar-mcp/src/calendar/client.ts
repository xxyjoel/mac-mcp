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

export class CalendarClient {
  private readonly DEFAULT_TIMEOUT = 120000; // 120 seconds
  private readonly SEARCH_TIMEOUT = 180000; // 180 seconds for search operations
  private cache: CalendarCache;
  
  constructor() {
    this.cache = new CalendarCache();
  }
  
  private getTimeout(operation: 'list' | 'get' | 'search' = 'list'): number {
    // Allow environment variables to override defaults
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
      // Write script to a temporary file to avoid shell escaping issues
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
      
      set eventList to {}
      
      tell application "Calendar"
        ${calendarName ? `
        set targetCalendar to calendar "${calendarName}"
        try
          -- First check if this is a large calendar
          set eventCount to count of events of targetCalendar
          
          if eventCount > 2000 then
            -- For large calendars, only get events from recent months
            set currentYear to year of (current date)
            set yearStart to current date
            set month of yearStart to 1
            set day of yearStart to 1
            set time of yearStart to 0
            
            -- Use whose clause with year filter for better performance
            set calEvents to (events of targetCalendar whose start date >= yearStart and start date >= startDate and start date <= endDate)
          else
            -- For smaller calendars, use standard filtering
            set calEvents to (events of targetCalendar whose start date >= startDate and start date <= endDate)
          end if
          
          repeat with evt in calEvents
            set end of eventList to evt
          end repeat
        on error errorMsg
          -- If filtering fails, return empty list for this calendar
          -- This prevents the entire query from failing due to one problematic calendar
        end try` : 
        `set maxCalendarsToCheck to 10
        set calendarCount to 0
        repeat with cal in calendars
          if calendarCount < maxCalendarsToCheck then
            set calendarCount to calendarCount + 1
            try
              -- Use whose clause for better performance
              set calEvents to (events of cal whose start date >= startDate and start date <= endDate)
              repeat with evt in calEvents
                set end of eventList to evt
              end repeat
            on error
              -- Skip calendars that cause errors
            end try
          end if
        end repeat`}
        
        set output to ""
        repeat with evt in eventList
          set eventId to uid of evt
          set eventTitle to summary of evt
          set eventStart to (start date of evt) as string
          set eventEnd to (end date of evt) as string
          set eventCalendar to name of (calendar of evt)
          set eventAllDay to allday event of evt
          
          set eventLocation to ""
          try
            set eventLocation to location of evt
          end try
          
          set eventDescription to ""
          try
            set eventDescription to description of evt
          end try
          
          set output to output & eventId & "|" & eventTitle & "|" & eventStart & "|" & eventEnd & "|" & eventLocation & "|" & eventDescription & "|" & eventCalendar & "|" & eventAllDay & "\\n"
        end repeat
        
        return output
      end tell
    `;

    const result = await this.runAppleScript(script, 'list');
    if (!result) return [];

    const events = result.split("\n").filter(line => line.trim()).map(line => {
      const [id, title, startDate, endDate, location, description, calendarName, isAllDay] = line.split("|");
      return {
        id,
        title,
        startDate,
        endDate,
        location: location || undefined,
        description: description || undefined,
        calendarName,
        isAllDay: isAllDay === "true",
      };
    });

    // Cache the results
    if (events.length > 0) {
      await this.cache.cacheEvents(events, calendarName);
    }

    return events;
  }

  async getEvent(eventId: string): Promise<CalendarEvent | null> {
    // Try cache first
    const cachedEvent = await this.cache.getCachedEvent(eventId);
    if (cachedEvent !== null) {
      console.error(`Calendar cache hit: event ${eventId} found`);
      return cachedEvent;
    }
    
    console.error(`Calendar cache miss: fetching event ${eventId} from AppleScript`);
    const script = `
      tell application "Calendar"
        set targetEvent to null
        repeat with cal in calendars
          try
            set targetEvent to (first event of cal whose uid is "${eventId}")
            exit repeat
          end try
        end repeat
        
        if targetEvent is null then
          return ""
        end if
        
        set eventTitle to summary of targetEvent
        set eventStart to (start date of targetEvent) as string
        set eventEnd to (end date of targetEvent) as string
        set eventCalendar to name of (calendar of targetEvent)
        set eventAllDay to allday event of targetEvent
        
        set eventLocation to ""
        try
          set eventLocation to location of targetEvent
        end try
        
        set eventDescription to ""
        try
          set eventDescription to description of targetEvent
        end try
        
        return "${eventId}|" & eventTitle & "|" & eventStart & "|" & eventEnd & "|" & eventLocation & "|" & eventDescription & "|" & eventCalendar & "|" & eventAllDay
      end tell
    `;

    const result = await this.runAppleScript(script, 'get');
    if (!result) return null;

    const [id, title, startDate, endDate, location, description, calendarName, isAllDay] = result.split("|");
    return {
      id,
      title,
      startDate,
      endDate,
      location: location || undefined,
      description: description || undefined,
      calendarName,
      isAllDay: isAllDay === "true",
    };
  }

  async searchEvents(
    query: string,
    startDate?: string,
    endDate?: string
  ): Promise<CalendarEvent[]> {
    // Try cache first if dates are provided
    if (startDate && endDate) {
      const cachedEvents = await this.cache.searchCachedEvents(query, startDate, endDate);
      if (cachedEvents !== null) {
        console.error(`Calendar cache hit: ${cachedEvents.length} events found for query "${query}"`);
        return cachedEvents;
      }
    }
    
    console.error(`Calendar cache miss: searching for "${query}" via AppleScript`);
    let dateSetup = "";
    if (startDate && endDate) {
      const startParts = startDate.split('-');
      const endParts = endDate.split('-');
      dateSetup = `
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
      `;
    }
    
    const script = `
      set searchQuery to "${query}"
      ${dateSetup}
      set eventList to {}
      
      tell application "Calendar"
        set maxResults to 100
        set resultCount to 0
        set maxCalendarsToSearch to 5
        set calendarCount to 0
        
        repeat with cal in calendars
          if resultCount < maxResults and calendarCount < maxCalendarsToSearch then
            set calendarCount to calendarCount + 1
            try
              -- Get a limited number of events to avoid timeout
              if ${startDate && endDate ? 'true' : 'false'} then
                set calEvents to (events of cal whose start date >= startDate and start date <= endDate)
              else
                -- Without date filter, just get recent events
                set calEvents to events of cal
              end if
              
              repeat with evt in calEvents
                if resultCount < maxResults then
                  set eventTitle to summary of evt
                  set eventDescription to ""
                  try
                    set eventDescription to description of evt
                  end try
                  
                  if (eventTitle contains searchQuery) or (eventDescription contains searchQuery) then
                    set resultCount to resultCount + 1
                    set eventId to uid of evt
                    set eventStart to (start date of evt) as string
                    set eventEnd to (end date of evt) as string
                    set eventCalendar to name of cal
                    set eventAllDay to allday event of evt
                    
                    set eventLocation to ""
                    try
                      set eventLocation to location of evt
                    end try
                    
                    set end of eventList to eventId & "|" & eventTitle & "|" & eventStart & "|" & eventEnd & "|" & eventLocation & "|" & eventDescription & "|" & eventCalendar & "|" & eventAllDay
                  end if
                end if
              end repeat
            on error
              -- Skip calendars that cause errors
            end try
          end if
        end repeat
        
        set output to ""
        repeat with evt in eventList
          set output to output & evt & "\\n"
        end repeat
        
        return output
      end tell
    `;

    const result = await this.runAppleScript(script, 'search');
    if (!result) return [];

    const events = result.split("\n").filter(line => line.trim()).map(line => {
      const [id, title, startDate, endDate, location, description, calendarName, isAllDay] = line.split("|");
      return {
        id,
        title,
        startDate,
        endDate,
        location: location || undefined,
        description: description || undefined,
        calendarName,
        isAllDay: isAllDay === "true",
      };
    });

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

  async getCalendarEventCount(calendarName: string): Promise<number> {
    const script = `
      tell application "Calendar"
        try
          set cal to calendar "${calendarName}"
          return count of events of cal
        on error
          return 0
        end try
      end tell
    `;
    
    const result = await this.runAppleScript(script, 'get');
    return parseInt(result, 10) || 0;
  }

  // Cleanup method
  close(): void {
    this.cache.close();
  }
}