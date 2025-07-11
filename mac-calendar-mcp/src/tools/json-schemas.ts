export const listEventsJsonSchema = {
  type: "object",
  properties: {
    startDate: {
      type: "string",
      description: "Start date in ISO format (YYYY-MM-DD)"
    },
    endDate: {
      type: "string",
      description: "End date in ISO format (YYYY-MM-DD)"
    },
    calendarName: {
      type: "string",
      description: "Optional calendar name filter"
    }
  },
  required: ["startDate", "endDate"]
};

export const getEventJsonSchema = {
  type: "object",
  properties: {
    eventId: {
      type: "string",
      description: "The unique identifier of the event"
    }
  },
  required: ["eventId"]
};

export const searchEventsJsonSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Search query for event title or description"
    },
    startDate: {
      type: "string",
      description: "Optional start date filter in ISO format"
    },
    endDate: {
      type: "string",
      description: "Optional end date filter in ISO format"
    }
  },
  required: ["query"]
};

export const getCalendarInfoJsonSchema = {
  type: "object",
  properties: {},
  required: []
};

export const getEventCountJsonSchema = {
  type: "object",
  properties: {
    calendarName: {
      type: "string",
      description: "The name of the calendar to count events for"
    }
  },
  required: ["calendarName"]
};