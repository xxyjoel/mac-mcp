#!/usr/bin/env swift

import EventKit
import Foundation
import AppKit

// JSON output structures
struct ReminderList: Codable {
    let id: String
    let title: String
    let color: String?
    let reminderCount: Int
}

struct Reminder: Codable {
    let id: String
    let title: String
    let notes: String?
    let isCompleted: Bool
    let priority: Int
    let dueDate: String?
    let hasAlarm: Bool
    let listId: String
    let listName: String
    let creationDate: String
    let lastModifiedDate: String
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
    Usage: reminders-helper <command> [options]
    Commands:
      list-lists
      list-reminders <list-name> [include-completed]
      get-reminder <reminder-id>
      search-reminders <query>
      get-upcoming <days>
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

// Request reminder access
let semaphore = DispatchSemaphore(value: 0)
var accessGranted = false

if #available(macOS 14.0, *) {
    eventStore.requestFullAccessToReminders { granted, error in
        accessGranted = granted
        semaphore.signal()
    }
} else {
    eventStore.requestAccess(to: .reminder) { granted, error in
        accessGranted = granted
        semaphore.signal()
    }
}

semaphore.wait()

if !accessGranted {
    outputJSON(ErrorResponse(error: "Reminder access denied"))
    exit(1)
}

// Helper to convert color
func colorToHex(_ color: NSColor?) -> String? {
    guard let color = color else { return nil }
    return String(format: "#%02X%02X%02X", 
                  Int(color.redComponent * 255),
                  Int(color.greenComponent * 255),
                  Int(color.blueComponent * 255))
}

// Execute command
switch command {
case "list-lists":
    let calendars = eventStore.calendars(for: .reminder)
    let lists = calendars.map { calendar in
        // Get reminder count
        let predicate = eventStore.predicateForReminders(in: [calendar])
        let group = DispatchGroup()
        var count = 0
        
        group.enter()
        eventStore.fetchReminders(matching: predicate) { reminders in
            count = reminders?.count ?? 0
            group.leave()
        }
        group.wait()
        
        return ReminderList(
            id: calendar.calendarIdentifier,
            title: calendar.title,
            color: colorToHex(calendar.color),
            reminderCount: count
        )
    }
    outputJSON(lists)
    
case "list-reminders":
    guard args.count >= 3 else {
        outputJSON(ErrorResponse(error: "Missing required argument: list-name"))
        exit(1)
    }
    
    let listName = args[2]
    let includeCompleted = args.count > 3 && args[3] == "true"
    
    // Find the calendar
    let calendars = eventStore.calendars(for: .reminder)
    guard let calendar = calendars.first(where: { $0.title == listName }) else {
        outputJSON(ErrorResponse(error: "List not found: \(listName)"))
        exit(1)
    }
    
    // Fetch reminders
    let predicate = eventStore.predicateForReminders(in: [calendar])
    let group = DispatchGroup()
    var reminders: [EKReminder] = []
    
    group.enter()
    eventStore.fetchReminders(matching: predicate) { fetchedReminders in
        reminders = fetchedReminders ?? []
        group.leave()
    }
    group.wait()
    
    // Filter completed if needed
    if !includeCompleted {
        reminders = reminders.filter { !$0.isCompleted }
    }
    
    // Convert to our structure
    let reminderList = reminders.map { reminder in
        Reminder(
            id: reminder.calendarItemIdentifier,
            title: reminder.title ?? "Untitled",
            notes: reminder.notes,
            isCompleted: reminder.isCompleted,
            priority: reminder.priority,
            dueDate: reminder.dueDateComponents?.date.map { dateFormatter.string(from: $0) },
            hasAlarm: reminder.hasAlarms,
            listId: calendar.calendarIdentifier,
            listName: calendar.title,
            creationDate: dateFormatter.string(from: reminder.creationDate ?? Date()),
            lastModifiedDate: dateFormatter.string(from: reminder.lastModifiedDate ?? Date())
        )
    }
    
    outputJSON(reminderList)
    
case "get-reminder":
    guard args.count >= 3 else {
        outputJSON(ErrorResponse(error: "Missing required argument: reminder-id"))
        exit(1)
    }
    
    let reminderId = args[2]
    
    // Search all lists
    let calendars = eventStore.calendars(for: .reminder)
    var foundReminder: EKReminder?
    var foundCalendar: EKCalendar?
    
    for calendar in calendars {
        let predicate = eventStore.predicateForReminders(in: [calendar])
        let group = DispatchGroup()
        
        group.enter()
        eventStore.fetchReminders(matching: predicate) { reminders in
            if let reminder = reminders?.first(where: { $0.calendarItemIdentifier == reminderId }) {
                foundReminder = reminder
                foundCalendar = calendar
            }
            group.leave()
        }
        group.wait()
        
        if foundReminder != nil { break }
    }
    
    guard let reminder = foundReminder, let calendar = foundCalendar else {
        outputJSON(ErrorResponse(error: "Reminder not found: \(reminderId)"))
        exit(1)
    }
    
    let result = Reminder(
        id: reminder.calendarItemIdentifier,
        title: reminder.title ?? "Untitled",
        notes: reminder.notes,
        isCompleted: reminder.isCompleted,
        priority: reminder.priority,
        dueDate: reminder.dueDateComponents?.date.map { dateFormatter.string(from: $0) },
        hasAlarm: reminder.hasAlarms,
        listId: calendar.calendarIdentifier,
        listName: calendar.title,
        creationDate: dateFormatter.string(from: reminder.creationDate ?? Date()),
        lastModifiedDate: dateFormatter.string(from: reminder.lastModifiedDate ?? Date())
    )
    
    outputJSON(result)
    
case "search-reminders":
    guard args.count >= 3 else {
        outputJSON(ErrorResponse(error: "Missing required argument: query"))
        exit(1)
    }
    
    let query = args[2].lowercased()
    let calendars = eventStore.calendars(for: .reminder)
    var allReminders: [(EKReminder, EKCalendar)] = []
    
    // Fetch from all lists
    for calendar in calendars {
        let predicate = eventStore.predicateForReminders(in: [calendar])
        let group = DispatchGroup()
        
        group.enter()
        eventStore.fetchReminders(matching: predicate) { reminders in
            if let reminders = reminders {
                let matches = reminders.filter { reminder in
                    let titleMatch = reminder.title?.lowercased().contains(query) ?? false
                    let notesMatch = reminder.notes?.lowercased().contains(query) ?? false
                    return titleMatch || notesMatch
                }
                allReminders.append(contentsOf: matches.map { ($0, calendar) })
            }
            group.leave()
        }
        group.wait()
    }
    
    // Convert to output format
    let results = allReminders.map { (reminder, calendar) in
        Reminder(
            id: reminder.calendarItemIdentifier,
            title: reminder.title ?? "Untitled",
            notes: reminder.notes,
            isCompleted: reminder.isCompleted,
            priority: reminder.priority,
            dueDate: reminder.dueDateComponents?.date.map { dateFormatter.string(from: $0) },
            hasAlarm: reminder.hasAlarms,
            listId: calendar.calendarIdentifier,
            listName: calendar.title,
            creationDate: dateFormatter.string(from: reminder.creationDate ?? Date()),
            lastModifiedDate: dateFormatter.string(from: reminder.lastModifiedDate ?? Date())
        )
    }
    
    outputJSON(results)
    
case "get-upcoming":
    guard args.count >= 3 else {
        outputJSON(ErrorResponse(error: "Missing required argument: days"))
        exit(1)
    }
    
    let days = Int(args[2]) ?? 7
    let calendars = eventStore.calendars(for: .reminder)
    
    // Create date range
    let startDate = Date()
    let endDate = Calendar.current.date(byAdding: .day, value: days, to: startDate) ?? startDate
    
    // Use date-based predicate
    let predicate = eventStore.predicateForIncompleteReminders(
        withDueDateStarting: startDate,
        ending: endDate,
        calendars: calendars
    )
    
    let group = DispatchGroup()
    var upcomingReminders: [(EKReminder, EKCalendar)] = []
    
    group.enter()
    eventStore.fetchReminders(matching: predicate) { reminders in
        if let reminders = reminders {
            // Map reminders to their calendars
            for reminder in reminders {
                if let calendar = reminder.calendar {
                    upcomingReminders.append((reminder, calendar))
                }
            }
        }
        group.leave()
    }
    group.wait()
    
    // Sort by due date
    upcomingReminders.sort { (a, b) in
        let dateA = a.0.dueDateComponents?.date ?? Date.distantFuture
        let dateB = b.0.dueDateComponents?.date ?? Date.distantFuture
        return dateA < dateB
    }
    
    // Convert to output format
    let results = upcomingReminders.map { (reminder, calendar) in
        Reminder(
            id: reminder.calendarItemIdentifier,
            title: reminder.title ?? "Untitled",
            notes: reminder.notes,
            isCompleted: reminder.isCompleted,
            priority: reminder.priority,
            dueDate: reminder.dueDateComponents?.date.map { dateFormatter.string(from: $0) },
            hasAlarm: reminder.hasAlarms,
            listId: calendar.calendarIdentifier,
            listName: calendar.title,
            creationDate: dateFormatter.string(from: reminder.creationDate ?? Date()),
            lastModifiedDate: dateFormatter.string(from: reminder.lastModifiedDate ?? Date())
        )
    }
    
    outputJSON(results)
    
default:
    outputJSON(ErrorResponse(error: "Unknown command: \(command)"))
    exit(1)
}