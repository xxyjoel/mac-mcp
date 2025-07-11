#!/usr/bin/env swift

import Foundation
import Cocoa

// Note: Mail doesn't have a direct Swift framework like EventKit
// We'll use AppleScript bridging with better performance optimizations

// JSON output structures
struct MailFolder: Codable {
    let name: String
    let accountName: String
    let messageCount: Int
    let unreadCount: Int
}

struct MailMessage: Codable {
    let id: String
    let subject: String
    let sender: String
    let senderName: String?
    let recipients: [String]
    let dateSent: String
    let dateReceived: String
    let snippet: String?
    let mailbox: String
    let accountName: String
    let isRead: Bool
    let isFlagged: Bool
    let hasAttachments: Bool
}

struct MailAttachment: Codable {
    let name: String
    let size: Int
    let mimeType: String?
}

struct ErrorResponse: Codable {
    let error: String
}

// Date formatter
let dateFormatter = ISO8601DateFormatter()
dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

// Parse command line arguments
let args = CommandLine.arguments

if args.count < 2 {
    print("""
    Usage: mail-helper <command> [options]
    Commands:
      list-folders
      list-messages <mailbox> <limit> [account]
      get-message <message-id>
      search-messages <query> <search-in> <limit>
      get-attachments <message-id>
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

// Helper to run AppleScript efficiently
func runAppleScript(_ script: String) -> String? {
    let task = Process()
    task.launchPath = "/usr/bin/osascript"
    task.arguments = ["-e", script]
    
    let pipe = Pipe()
    task.standardOutput = pipe
    task.standardError = pipe
    
    do {
        try task.run()
        task.waitUntilExit()
        
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    } catch {
        return nil
    }
}

// Execute command
switch command {
case "list-folders":
    let script = """
    set folderList to {}
    tell application "Mail"
        repeat with acct in accounts
            set acctName to name of acct
            repeat with mbox in mailboxes of acct
                try
                    set mboxName to name of mbox
                    set msgCount to count of messages of mbox
                    set unreadCount to count of (messages of mbox whose read status is false)
                    set folderInfo to acctName & "|" & mboxName & "|" & msgCount & "|" & unreadCount
                    set end of folderList to folderInfo
                end try
            end repeat
        end repeat
    end tell
    set AppleScript's text item delimiters to "\\n"
    return folderList as string
    """
    
    if let result = runAppleScript(script), !result.isEmpty {
        let folders = result.split(separator: "\n").compactMap { line -> MailFolder? in
            let parts = line.split(separator: "|").map(String.init)
            guard parts.count >= 4 else { return nil }
            return MailFolder(
                name: parts[1],
                accountName: parts[0],
                messageCount: Int(parts[2]) ?? 0,
                unreadCount: Int(parts[3]) ?? 0
            )
        }
        outputJSON(folders)
    } else {
        outputJSON(ErrorResponse(error: "Failed to list folders"))
    }
    
case "list-messages":
    guard args.count >= 4 else {
        outputJSON(ErrorResponse(error: "Missing required arguments: mailbox limit"))
        exit(1)
    }
    
    let mailbox = args[2]
    let limit = args[3]
    let account = args.count > 4 ? args[4] : nil
    
    var script = """
    set messageList to {}
    set maxMessages to \(limit)
    
    tell application "Mail"
    """
    
    if let account = account {
        script += """
        
        set targetAccount to account "\(account)"
        set targetMailbox to mailbox "\(mailbox)" of targetAccount
        """
    } else {
        script += """
        
        set targetMailbox to null
        repeat with acct in accounts
            try
                set targetMailbox to mailbox "\(mailbox)" of acct
                exit repeat
            end try
        end repeat
        if targetMailbox is null then
            return ""
        end if
        """
    }
    
    script += """
    
        set allMessages to messages of targetMailbox
        set messageCount to count of allMessages
        
        if messageCount > maxMessages then
            set messagesToProcess to items 1 thru maxMessages of allMessages
        else
            set messagesToProcess to allMessages
        end if
        
        repeat with msg in messagesToProcess
            try
                set msgId to message id of msg
                set msgSubject to subject of msg
                set msgSender to sender of msg
                set msgDateSent to (date sent of msg) as string
                set msgDateReceived to (date received of msg) as string
                set msgMailbox to name of mailbox of msg
                set msgAccount to name of account of mailbox of msg
                set msgRead to read status of msg
                set msgFlagged to flagged status of msg
                
                set hasAttach to false
                try
                    if (count of mail attachments of msg) > 0 then set hasAttach to true
                end try
                
                set msgSnippet to ""
                try
                    set msgContent to content of msg
                    if length of msgContent > 200 then
                        set msgSnippet to text 1 thru 200 of msgContent
                    else
                        set msgSnippet to msgContent
                    end if
                end try
                
                set messageInfo to msgId & "|" & msgSubject & "|" & msgSender & "|" & msgDateSent & "|" & msgDateReceived & "|" & msgMailbox & "|" & msgAccount & "|" & msgRead & "|" & msgFlagged & "|" & hasAttach & "|" & msgSnippet
                set end of messageList to messageInfo
            end try
        end repeat
    end tell
    
    set AppleScript's text item delimiters to "\\n"
    return messageList as string
    """
    
    if let result = runAppleScript(script), !result.isEmpty {
        let messages = result.split(separator: "\n").compactMap { line -> MailMessage? in
            let parts = line.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            guard parts.count >= 10 else { return nil }
            
            return MailMessage(
                id: parts[0],
                subject: parts[1].isEmpty ? "(No Subject)" : parts[1],
                sender: parts[2],
                senderName: nil,
                recipients: [],
                dateSent: parts[3],
                dateReceived: parts[4],
                snippet: parts.count > 10 ? parts[10] : nil,
                mailbox: parts[5],
                accountName: parts[6],
                isRead: parts[7] == "true",
                isFlagged: parts[8] == "true",
                hasAttachments: parts[9] == "true"
            )
        }
        outputJSON(messages)
    } else {
        outputJSON([MailMessage]())
    }
    
case "search-messages":
    guard args.count >= 5 else {
        outputJSON(ErrorResponse(error: "Missing required arguments: query search-in limit"))
        exit(1)
    }
    
    let query = args[2]
    let searchIn = args[3]
    let limit = args[4]
    
    var searchCondition = ""
    switch searchIn {
    case "subject":
        searchCondition = "whose subject contains \"\(query)\""
    case "sender":
        searchCondition = "whose sender contains \"\(query)\""
    case "content":
        // Content search is very slow, we'll limit it
        searchCondition = "whose content contains \"\(query)\""
    default:
        searchCondition = "whose subject contains \"\(query)\" or sender contains \"\(query)\""
    }
    
    let script = """
    set messageList to {}
    set maxResults to \(limit)
    set resultCount to 0
    
    tell application "Mail"
        -- Search only in primary accounts to improve performance
        repeat with acct in accounts
            if resultCount < maxResults then
                try
                    -- Get inbox and sent mailboxes for faster search
                    set searchMailboxes to {inbox of acct}
                    try
                        set end of searchMailboxes to mailbox "Sent" of acct
                    end try
                    
                    repeat with mbox in searchMailboxes
                        if resultCount < maxResults then
                            try
                                set foundMessages to (messages of mbox \(searchCondition))
                                repeat with msg in foundMessages
                                    if resultCount < maxResults then
                                        set msgId to message id of msg
                                        set msgSubject to subject of msg
                                        set msgSender to sender of msg
                                        set msgDate to (date sent of msg) as string
                                        set msgMailbox to name of mbox
                                        set msgAccount to name of acct
                                        
                                        set messageInfo to msgId & "|" & msgSubject & "|" & msgSender & "|" & msgDate & "|" & msgMailbox & "|" & msgAccount
                                        set end of messageList to messageInfo
                                        set resultCount to resultCount + 1
                                    end if
                                end repeat
                            end try
                        end if
                    end repeat
                end try
            end if
        end repeat
    end tell
    
    set AppleScript's text item delimiters to "\\n"
    return messageList as string
    """
    
    if let result = runAppleScript(script), !result.isEmpty {
        let messages = result.split(separator: "\n").compactMap { line -> MailMessage? in
            let parts = line.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            guard parts.count >= 6 else { return nil }
            
            return MailMessage(
                id: parts[0],
                subject: parts[1].isEmpty ? "(No Subject)" : parts[1],
                sender: parts[2],
                senderName: nil,
                recipients: [],
                dateSent: parts[3],
                dateReceived: parts[3],
                snippet: nil,
                mailbox: parts[4],
                accountName: parts[5],
                isRead: false,
                isFlagged: false,
                hasAttachments: false
            )
        }
        outputJSON(messages)
    } else {
        outputJSON([MailMessage]())
    }
    
case "get-message":
    guard args.count >= 3 else {
        outputJSON(ErrorResponse(error: "Missing required argument: message-id"))
        exit(1)
    }
    
    let messageId = args[2]
    
    let script = """
    tell application "Mail"
        set targetMessage to null
        
        repeat with acct in accounts
            repeat with mbox in mailboxes of acct
                try
                    set msgs to (messages of mbox whose message id is "\(messageId)")
                    if count of msgs > 0 then
                        set targetMessage to item 1 of msgs
                        exit repeat
                    end if
                end try
            end repeat
            if targetMessage is not null then exit repeat
        end repeat
        
        if targetMessage is null then
            return ""
        end if
        
        set msgId to message id of targetMessage
        set msgSubject to subject of targetMessage
        set msgSender to sender of targetMessage
        set msgDateSent to (date sent of targetMessage) as string
        set msgDateReceived to (date received of targetMessage) as string
        set msgMailbox to name of mailbox of targetMessage
        set msgAccount to name of account of mailbox of targetMessage
        set msgRead to read status of targetMessage
        set msgFlagged to flagged status of targetMessage
        
        set msgContent to ""
        try
            set msgContent to content of targetMessage
            if length of msgContent > 50000 then
                set msgContent to text 1 thru 50000 of msgContent & "\\n[Content truncated]"
            end if
        end try
        
        set hasAttach to false
        try
            if (count of mail attachments of targetMessage) > 0 then set hasAttach to true
        end try
        
        set recipientList to {}
        try
            repeat with recip in to recipients of targetMessage
                set end of recipientList to address of recip
            end repeat
        end try
        set AppleScript's text item delimiters to ","
        set recipientString to recipientList as string
        
        return msgId & "|" & msgSubject & "|" & msgSender & "|" & msgDateSent & "|" & msgDateReceived & "|" & msgMailbox & "|" & msgAccount & "|" & msgRead & "|" & msgFlagged & "|" & hasAttach & "|" & recipientString & "|" & msgContent
    end tell
    """
    
    if let result = runAppleScript(script), !result.isEmpty {
        let parts = result.split(separator: "|", maxSplits: 11, omittingEmptySubsequences: false).map(String.init)
        guard parts.count >= 12 else {
            outputJSON(ErrorResponse(error: "Invalid message data"))
            exit(1)
        }
        
        let message = MailMessage(
            id: parts[0],
            subject: parts[1].isEmpty ? "(No Subject)" : parts[1],
            sender: parts[2],
            senderName: nil,
            recipients: parts[10].isEmpty ? [] : parts[10].split(separator: ",").map(String.init),
            dateSent: parts[3],
            dateReceived: parts[4],
            snippet: parts[11].prefix(200).description,
            mailbox: parts[5],
            accountName: parts[6],
            isRead: parts[7] == "true",
            isFlagged: parts[8] == "true",
            hasAttachments: parts[9] == "true"
        )
        outputJSON(message)
    } else {
        outputJSON(ErrorResponse(error: "Message not found"))
    }
    
case "get-attachments":
    guard args.count >= 3 else {
        outputJSON(ErrorResponse(error: "Missing required argument: message-id"))
        exit(1)
    }
    
    let messageId = args[2]
    
    let script = """
    tell application "Mail"
        set targetMessage to null
        
        repeat with acct in accounts
            repeat with mbox in mailboxes of acct
                try
                    set msgs to (messages of mbox whose message id is "\(messageId)")
                    if count of msgs > 0 then
                        set targetMessage to item 1 of msgs
                        exit repeat
                    end if
                end try
            end repeat
            if targetMessage is not null then exit repeat
        end repeat
        
        if targetMessage is null then
            return ""
        end if
        
        set attachmentList to {}
        try
            repeat with attach in mail attachments of targetMessage
                set attachName to name of attach
                set attachSize to 0
                try
                    set attachSize to size of attach
                end try
                
                set attachInfo to attachName & "|" & attachSize
                set end of attachmentList to attachInfo
            end repeat
        end try
        
        set AppleScript's text item delimiters to "\\n"
        return attachmentList as string
    end tell
    """
    
    if let result = runAppleScript(script), !result.isEmpty {
        let attachments = result.split(separator: "\n").compactMap { line -> MailAttachment? in
            let parts = line.split(separator: "|").map(String.init)
            guard parts.count >= 2 else { return nil }
            
            let filename = parts[0]
            let ext = (filename as NSString).pathExtension.lowercased()
            
            let mimeTypes: [String: String] = [
                "pdf": "application/pdf",
                "doc": "application/msword",
                "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "png": "image/png",
                "jpg": "image/jpeg",
                "jpeg": "image/jpeg",
                "txt": "text/plain",
                "zip": "application/zip"
            ]
            
            return MailAttachment(
                name: filename,
                size: Int(parts[1]) ?? 0,
                mimeType: mimeTypes[ext] ?? "application/octet-stream"
            )
        }
        outputJSON(attachments)
    } else {
        outputJSON([MailAttachment]())
    }
    
default:
    outputJSON(ErrorResponse(error: "Unknown command: \(command)"))
    exit(1)
}