import { promisify } from "util";
import { exec } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { CalendarEvent } from "./client.js";
import { CalendarCache } from "../cache/database.js";

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

interface SwiftCalendarInfo {
  id: string;
  title: string;
  eventCount?: number;
}

interface SwiftEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  location?: string;
  notes?: string;
  calendarName: string;
  calendarId: string;
  isAllDay: boolean;
}

export class EventKitClient {
  private helperPath: string;
  private cache: CalendarCache;
  
  constructor() {
    // Helper binary is in the project root
    this.helperPath = join(__dirname, '../../calendar-helper');
    this.cache = new CalendarCache();
  }
  
  private async runHelper(command: string, ...args: string[]): Promise<any> {
    const cmdArgs = [command, ...args.map(arg => `"${arg}"`)].join(' ');
    
    try {
      const { stdout, stderr } = await execAsync(`"${this.helperPath}" ${cmdArgs}`, {
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large results
      });
      
      if (stderr) {
        console.error('Helper stderr:', stderr);
      }
      
      const result = JSON.parse(stdout);
      
      // Check for error response
      if (result.error) {
        throw new Error(result.error);
      }
      
      return result;
    } catch (error: any) {
      if (error.message.includes('Calendar access denied')) {
        throw new Error('Calendar access denied. Please grant permission in System Preferences > Security & Privacy > Privacy > Calendar');
      }
      throw new Error(`Failed to execute calendar helper: ${error.message || error}`);
    }
  }
  
  private convertSwiftEvent(swiftEvent: SwiftEvent): CalendarEvent {
    // Convert ISO8601 dates to more readable format
    const startDate = new Date(swiftEvent.startDate);
    const endDate = new Date(swiftEvent.endDate);
    
    const formatDate = (date: Date) => {
      return date.toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      });
    };
    
    return {
      id: swiftEvent.id,
      title: swiftEvent.title,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      location: swiftEvent.location,
      description: swiftEvent.notes,
      calendarName: swiftEvent.calendarName,
      isAllDay: swiftEvent.isAllDay
    };
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
    
    console.error(`Calendar cache miss: fetching from EventKit`);
    
    // Convert dates to ISO8601 format for Swift helper
    const startISO = new Date(startDate + 'T00:00:00').toISOString();
    const endISO = new Date(endDate + 'T23:59:59').toISOString();
    
    const args = calendarName 
      ? [startISO, endISO, calendarName]
      : [startISO, endISO];
    
    const swiftEvents = await this.runHelper('list-events', ...args) as SwiftEvent[];
    const events = swiftEvents.map(evt => this.convertSwiftEvent(evt));
    
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
    
    console.error(`Calendar cache miss: fetching event ${eventId} from EventKit`);
    
    try {
      const swiftEvent = await this.runHelper('get-event', eventId) as SwiftEvent;
      return this.convertSwiftEvent(swiftEvent);
    } catch (error: any) {
      if (error.message.includes('Event not found')) {
        return null;
      }
      throw error;
    }
  }
  
  async searchEvents(
    query: string,
    startDate?: string,
    endDate?: string
  ): Promise<CalendarEvent[]> {
    // For search, we'll use list-events and filter in memory
    // This is because EventKit doesn't have direct search predicates
    
    let allEvents: CalendarEvent[] = [];
    
    if (startDate && endDate) {
      allEvents = await this.listEvents(startDate, endDate);
    } else {
      // Search last year to next year by default
      const now = new Date();
      const lastYear = new Date(now);
      lastYear.setFullYear(now.getFullYear() - 1);
      const nextYear = new Date(now);
      nextYear.setFullYear(now.getFullYear() + 1);
      
      allEvents = await this.listEvents(
        lastYear.toISOString().split('T')[0],
        nextYear.toISOString().split('T')[0]
      );
    }
    
    // Filter by query
    const lowerQuery = query.toLowerCase();
    return allEvents.filter(event => 
      event.title.toLowerCase().includes(lowerQuery) ||
      (event.description && event.description.toLowerCase().includes(lowerQuery)) ||
      (event.location && event.location.toLowerCase().includes(lowerQuery))
    );
  }
  
  async getCalendars(): Promise<string[]> {
    // Try cache first
    const cachedCalendars = await this.cache.getCachedCalendars();
    if (cachedCalendars !== null) {
      console.error(`Calendar cache hit: ${cachedCalendars.length} calendars found`);
      return cachedCalendars.map(c => c.name);
    }
    
    console.error(`Calendar cache miss: fetching calendars from EventKit`);
    
    const calendars = await this.runHelper('list-calendars') as SwiftCalendarInfo[];
    const calendarNames = calendars.map(cal => cal.title);
    
    // Cache the calendar list
    await this.cache.cacheCalendars(calendarNames);
    
    return calendarNames;
  }
  
  async getCalendarEventCount(calendarName: string): Promise<number> {
    try {
      const result = await this.runHelper('count-events', calendarName);
      return result.count;
    } catch (error: any) {
      if (error.message.includes('Calendar not found')) {
        return 0;
      }
      throw error;
    }
  }
  
  // Cleanup method
  close(): void {
    this.cache.close();
  }
}