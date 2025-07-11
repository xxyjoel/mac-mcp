import { CalendarClient } from '../src/calendar/client';

describe('CalendarClient', () => {
  let client: CalendarClient;

  beforeEach(() => {
    client = new CalendarClient();
  });

  describe('listEvents', () => {
    it('should validate date formats', async () => {
      await expect(async () => {
        await client.listEvents('invalid-date', '2024-01-01');
      }).rejects.toThrow();
    });

    it('should return empty array when no events found', async () => {
      const events = await client.listEvents('2099-01-01', '2099-01-02');
      expect(Array.isArray(events)).toBe(true);
    });
  });

  describe('searchEvents', () => {
    it('should handle empty search results', async () => {
      const events = await client.searchEvents('unlikely-event-name-xyz123');
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBe(0);
    });
  });

  describe('getEvent', () => {
    it('should return null for non-existent event', async () => {
      const event = await client.getEvent('non-existent-id');
      expect(event).toBeNull();
    });
  });
});