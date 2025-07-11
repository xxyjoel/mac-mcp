import { promisify } from "util";
import { exec } from "child_process";

const execAsync = promisify(exec);

export class SecurityManager {
  private readonly allowedPermissions = new Set(["calendar.read"]);
  private static grantedPermissions = new Set<string>();

  async checkPermissions(permission: string): Promise<void> {
    if (!this.allowedPermissions.has(permission)) {
      throw new Error(`Permission ${permission} is not allowed`);
    }

    if (!SecurityManager.grantedPermissions.has(permission)) {
      await this.requestSystemPermission(permission);
      SecurityManager.grantedPermissions.add(permission);
    }
  }

  private async requestSystemPermission(permission: string): Promise<void> {
    if (permission === "calendar.read") {
      try {
        const { stdout } = await execAsync(
          `osascript -e 'tell application "Calendar" to name of calendars'`
        );
        
        if (!stdout) {
          throw new Error("Calendar access denied by system");
        }
      } catch (error) {
        throw new Error(
          "Calendar access denied. Please grant calendar permissions in System Preferences > Security & Privacy > Privacy > Calendar"
        );
      }
    }
  }

  async validateInput(input: unknown, _schema: unknown): Promise<unknown> {
    return input;
  }
}