#!/usr/bin/env swift

import EventKit
import Foundation

// JSON output structure
struct CalendarInfo: Codable {
    let id: String
    let title: String
    let eventCount: Int?
}

struct Event: Codable {
    let id: String
    let title: String
    let startDate: String
    let endDate: String
    let location: String?
    let notes: String?
    let calendarName: String
    let calendarId: String
    let isAllDay: Bool
}

struct ErrorResponse: Codable {
    let error: String
}

// Date formatter
let dateFormatter = ISO8601DateFormatter()
dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

// Create event store
let eventStore = EKEventStore()

// Parse command line arguments
let args = CommandLine.arguments

if args.count < 2 {
    print("""
    Usage: calendar-helper <command> [options]
    Commands:
      list-calendars
      list-events <start-date> <end-date> [calendar-name]
      get-event <event-id>
      count-events <calendar-name>
    """)
    exit(1)
}

let command = args[1]

// Helper function to encode and print JSON
func outputJSON<T: Encodable>(_ object: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    
    do {
        let jsonData = try encoder.encode(object)
        if let jsonString = String(data: jsonData, encoding: .utf8) {
            print(jsonString)
        }
    } catch {
        let errorResponse = ErrorResponse(error: "Failed to encode JSON: \(error.localizedDescription)")
        if let errorData = try? encoder.encode(errorResponse),
           let errorString = String(data: errorData, encoding: .utf8) {
            print(errorString)
        }
    }
}

// Request calendar access
let semaphore = DispatchSemaphore(value: 0)
var accessGranted = false

if #available(macOS 14.0, *) {
    eventStore.requestFullAccessToEvents { granted, error in
        accessGranted = granted
        semaphore.signal()
    }
} else {
    eventStore.requestAccess(to: .event) { granted, error in
        accessGranted = granted
        semaphore.signal()
    }
}

semaphore.wait()

if !accessGranted {
    outputJSON(ErrorResponse(error: "Calendar access denied"))
    exit(1)
}

// Execute command
switch command {
case "list-calendars":
    let calendars = eventStore.calendars(for: .event)
    let calendarInfos = calendars.map { calendar in
        CalendarInfo(
            id: calendar.calendarIdentifier,
            title: calendar.title,
            eventCount: nil
        )
    }
    outputJSON(calendarInfos)
    
case "list-events":
    guard args.count >= 4 else {
        outputJSON(ErrorResponse(error: "Missing required arguments: start-date end-date"))
        exit(1)
    }
    
    let startDateStr = args[2]
    let endDateStr = args[3]
    let calendarName = args.count > 4 ? args[4] : nil
    
    // Parse dates
    guard let startDate = dateFormatter.date(from: startDateStr),
          let endDate = dateFormatter.date(from: endDateStr) else {
        outputJSON(ErrorResponse(error: "Invalid date format. Use ISO8601 format (e.g., 2025-07-07T00:00:00Z)"))
        exit(1)
    }
    
    // Get calendars to search
    var calendarsToSearch = eventStore.calendars(for: .event)
    if let calendarName = calendarName {
        calendarsToSearch = calendarsToSearch.filter { $0.title == calendarName }
        if calendarsToSearch.isEmpty {
            outputJSON(ErrorResponse(error: "Calendar not found: \(calendarName)"))
            exit(1)
        }
    }
    
    // Create predicate and fetch events
    let predicate = eventStore.predicateForEvents(
        withStart: startDate,
        end: endDate,
        calendars: calendarsToSearch
    )
    
    let ekEvents = eventStore.events(matching: predicate)
    
    // Convert to our Event structure
    let events = ekEvents.map { ekEvent in
        Event(
            id: ekEvent.eventIdentifier,
            title: ekEvent.title ?? "Untitled",
            startDate: dateFormatter.string(from: ekEvent.startDate),
            endDate: dateFormatter.string(from: ekEvent.endDate),
            location: ekEvent.location,
            notes: ekEvent.notes,
            calendarName: ekEvent.calendar.title,
            calendarId: ekEvent.calendar.calendarIdentifier,
            isAllDay: ekEvent.isAllDay
        )
    }
    
    outputJSON(events)
    
case "get-event":
    guard args.count >= 3 else {
        outputJSON(ErrorResponse(error: "Missing required argument: event-id"))
        exit(1)
    }
    
    let eventId = args[2]
    
    // Search all calendars for the event
    for calendar in eventStore.calendars(for: .event) {
        if let ekEvent = eventStore.event(withIdentifier: eventId) {
            let event = Event(
                id: ekEvent.eventIdentifier,
                title: ekEvent.title ?? "Untitled",
                startDate: dateFormatter.string(from: ekEvent.startDate),
                endDate: dateFormatter.string(from: ekEvent.endDate),
                location: ekEvent.location,
                notes: ekEvent.notes,
                calendarName: ekEvent.calendar.title,
                calendarId: ekEvent.calendar.calendarIdentifier,
                isAllDay: ekEvent.isAllDay
            )
            outputJSON(event)
            exit(0)
        }
    }
    
    outputJSON(ErrorResponse(error: "Event not found: \(eventId)"))
    exit(1)
    
case "count-events":
    guard args.count >= 3 else {
        outputJSON(ErrorResponse(error: "Missing required argument: calendar-name"))
        exit(1)
    }
    
    let calendarName = args[2]
    
    // Find calendar
    guard let calendar = eventStore.calendars(for: .event).first(where: { $0.title == calendarName }) else {
        outputJSON(ErrorResponse(error: "Calendar not found: \(calendarName)"))
        exit(1)
    }
    
    // Count events using a very wide date range
    let startDate = Date(timeIntervalSince1970: 0) // 1970
    let endDate = Date(timeIntervalSinceNow: 365 * 24 * 60 * 60 * 10) // 10 years from now
    
    let predicate = eventStore.predicateForEvents(
        withStart: startDate,
        end: endDate,
        calendars: [calendar]
    )
    
    let eventCount = eventStore.events(matching: predicate).count
    
    struct CountResponse: Codable {
        let calendar: String
        let count: Int
    }
    outputJSON(CountResponse(calendar: calendarName, count: eventCount))
    
default:
    outputJSON(ErrorResponse(error: "Unknown command: \(command)"))
    exit(1)
}