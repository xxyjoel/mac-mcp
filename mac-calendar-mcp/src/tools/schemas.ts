import { z } from "zod";

export const listEventsToolSchema = z.object({
  startDate: z.string().describe("Start date in ISO format (YYYY-MM-DD)"),
  endDate: z.string().describe("End date in ISO format (YYYY-MM-DD)"),
  calendarName: z.string().optional().describe("Optional calendar name filter"),
});

export const getEventToolSchema = z.object({
  eventId: z.string().describe("The unique identifier of the event"),
});

export const searchEventsToolSchema = z.object({
  query: z.string().describe("Search query for event title or description"),
  startDate: z.string().optional().describe("Optional start date filter in ISO format"),
  endDate: z.string().optional().describe("Optional end date filter in ISO format"),
});

export const getCalendarInfoToolSchema = z.object({});

export const getEventCountToolSchema = z.object({
  calendarName: z.string().describe("The name of the calendar to count events for"),
});