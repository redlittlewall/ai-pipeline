import { Test, TestingModule } from '@nestjs/testing';
import { AiHealthService, AiHealthStatus } from './AiHealth.service';

describe('AiHealthService', () => {
  let service: AiHealthService;
  let envBackup: NodeJS.ProcessEnv;

  beforeEach(async () => {
    envBackup = { ...process.env };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AiHealthService],
    }).compile();

    service = module.get<AiHealthService>(AiHealthService);
  });

  afterEach(() => {
    process.env = envBackup;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('recordSuccess', () => {
    it('should reset consecutive failures to zero when failures exist (Happy Path)', async () => {
      // Arrange
      await service.recordFailure(new Error('Previous failure'));
      expect(service.getConsecutiveFailures()).toBe(1);

      // Act
      service.recordSuccess();

      // Assert
      expect(service.getConsecutiveFailures()).toBe(0);
    });

    it('should maintain zero consecutive failures when already zero', () => {
      // Act
      service.recordSuccess();

      // Assert
      expect(service.getConsecutiveFailures()).toBe(0);
    });
  });

  describe('recordFailure', () => {
    it('should increment consecutive failures and store Error message', async () => {
      // Act
      await service.recordFailure(new Error('Connection timeout'));

      // Assert
      expect(service.getConsecutiveFailures()).toBe(1);
      expect(service.getLastErrorMessage()).toBe('Connection timeout');
      expect(service.getLastFailureTimestamp()).toBeInstanceOf(Date);
    });

    it('should parse string error and update state', async () => {
      // Act
      await service.recordFailure('Raw string error');

      // Assert
      expect(service.getConsecutiveFailures()).toBe(1);
      expect(service.getLastErrorMessage()).toBe('Raw string error');
    });

    it('should stringify object error when message property is absent', async () => {
      // Act
      await service.recordFailure({ statusCode: 500, code: 'ERR_IA' });

      // Assert
      expect(service.getConsecutiveFailures()).toBe(1);
      expect(service.getLastErrorMessage()).toBe(
        JSON.stringify({ statusCode: 500, code: 'ERR_IA' }),
      );
    });

    it('should use default error message when error is undefined', async () => {
      // Act
      await service.recordFailure(undefined);

      // Assert
      expect(service.getConsecutiveFailures()).toBe(1);
      expect(service.getLastErrorMessage()).toBe(
        'Erro desconhecido na integração com IA',
      );
    });

    it('should not send health alert if consecutive failures is below threshold', async () => {
      // Arrange
      process.env.AI_MAX_CONSECUTIVE_FAILURES = '5';
      const mockEmailSender = {
        sendEmailToContact: jest.fn().mockResolvedValue({}),
      };
      (service as any).emailSender = mockEmailSender;

      // Act
      await service.recordFailure(new Error('Failure 1'));
      await service.recordFailure(new Error('Failure 2'));

      // Assert
      expect(service.getConsecutiveFailures()).toBe(2);
      expect(mockEmailSender.sendEmailToContact).not.toHaveBeenCalled();
    });

    it('should trigger alert email when max consecutive failures threshold is reached', async () => {
      // Arrange
      process.env.AI_MAX_CONSECUTIVE_FAILURES = '2';
      process.env.AI_ALERT_EMAILS = 'admin@tattoopop.com, dev@tattoopop.com';
      const mockEmailSender = {
        sendEmailToContact: jest.fn().mockResolvedValue({}),
      };
      (service as any).emailSender = mockEmailSender;

      // Act
      await service.recordFailure(new Error('Fail 1'));
      await service.recordFailure(new Error('Fail 2'));

      // Assert
      expect(service.getConsecutiveFailures()).toBe(2);
      expect(mockEmailSender.sendEmailToContact).toHaveBeenCalledTimes(2);
      expect(mockEmailSender.sendEmailToContact).toHaveBeenCalledWith(
        'ai-health-alert',
        'admin@tattoopop.com',
        expect.objectContaining({
          tokens: expect.objectContaining({
            subject: expect.stringContaining('[ALERTA TATTOOPOP]'),
            html: expect.stringContaining('Alerta de Saúde da IA'),
          }),
        }),
      );
      expect(service.getLastAlertSentTimestamp()).toBeInstanceOf(Date);
    });

    it('should suppress duplicate alerts when within debounce window', async () => {
      // Arrange
      process.env.AI_MAX_CONSECUTIVE_FAILURES = '1';
      process.env.AI_ALERT_EMAILS = 'admin@tattoopop.com';
      process.env.AI_ALERT_DEBOUNCE_MINUTES = '30';
      const mockEmailSender = {
        sendEmailToContact: jest.fn().mockResolvedValue({}),
      };
      (service as any).emailSender = mockEmailSender;

      // Act - First trigger
      await service.recordFailure(new Error('Fail 1'));
      // Act - Second trigger within debounce
      await service.recordFailure(new Error('Fail 2'));

      // Assert
      expect(mockEmailSender.sendEmailToContact).toHaveBeenCalledTimes(1);
    });

    it('should skip sending alert when AI_ALERT_EMAILS is not configured or empty', async () => {
      // Arrange
      process.env.AI_MAX_CONSECUTIVE_FAILURES = '1';
      process.env.AI_ALERT_EMAILS = ' , invalid-email ';
      const mockEmailSender = {
        sendEmailToContact: jest.fn().mockResolvedValue({}),
      };
      (service as any).emailSender = mockEmailSender;

      // Act
      await service.recordFailure(new Error('Fail 1'));

      // Assert
      expect(mockEmailSender.sendEmailToContact).not.toHaveBeenCalled();
    });

    it('should skip sending alert when emailSender is missing', async () => {
      // Arrange
      process.env.AI_MAX_CONSECUTIVE_FAILURES = '1';
      process.env.AI_ALERT_EMAILS = 'admin@tattoopop.com';
      (service as any).emailSender = undefined;

      // Act & Assert
      await expect(
        service.recordFailure(new Error('Fail 1')),
      ).resolves.toBeUndefined();
    });

    it('should handle errors thrown by sendEmailToContact gracefully', async () => {
      // Arrange
      process.env.AI_MAX_CONSECUTIVE_FAILURES = '1';
      process.env.AI_ALERT_EMAILS = 'admin@tattoopop.com';
      const mockEmailSender = {
        sendEmailToContact: jest
          .fn()
          .mockRejectedValue(new Error('SMTP Transport Error')),
      };
      (service as any).emailSender = mockEmailSender;

      // Act & Assert
      await expect(
        service.recordFailure(new Error('Fail 1')),
      ).resolves.toBeUndefined();
      expect(mockEmailSender.sendEmailToContact).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStatus', () => {
    it('should return HEALTHY when consecutive failures are between 0 and 2', () => {
      // Act & Assert
      expect(service.getStatus()).toBe(AiHealthStatus.HEALTHY);
    });

    it('should return DEGRADED when consecutive failures are 3 or 4', async () => {
      // Arrange
      process.env.AI_MAX_CONSECUTIVE_FAILURES = '10';
      await service.recordFailure('Err 1');
      await service.recordFailure('Err 2');
      await service.recordFailure('Err 3');

      // Act & Assert
      expect(service.getStatus()).toBe(AiHealthStatus.DEGRADED);
    });

    it('should return UNHEALTHY when consecutive failures are 5 or more', async () => {
      // Arrange
      process.env.AI_MAX_CONSECUTIVE_FAILURES = '10';
      for (let i = 0; i < 5; i++) {
        await service.recordFailure(`Err ${i + 1}`);
      }

      // Act & Assert
      expect(service.getStatus()).toBe(AiHealthStatus.UNHEALTHY);
    });
  });

  describe('getConsecutiveFailures', () => {
    it('should return 0 initially', () => {
      expect(service.getConsecutiveFailures()).toBe(0);
    });

    it('should return updated consecutive failure count', async () => {
      await service.recordFailure('Err');
      expect(service.getConsecutiveFailures()).toBe(1);
    });
  });

  describe('getLastFailureTimestamp', () => {
    it('should return null initially', () => {
      expect(service.getLastFailureTimestamp()).toBeNull();
    });

    it('should return timestamp after failure', async () => {
      await service.recordFailure('Err');
      expect(service.getLastFailureTimestamp()).toBeInstanceOf(Date);
    });
  });

  describe('getLastErrorMessage', () => {
    it('should return null initially', () => {
      expect(service.getLastErrorMessage()).toBeNull();
    });

    it('should return last error message after failure', async () => {
      await service.recordFailure(new Error('Custom AI error'));
      expect(service.getLastErrorMessage()).toBe('Custom AI error');
    });
  });

  describe('getLastAlertSentTimestamp', () => {
    it('should return null initially', () => {
      expect(service.getLastAlertSentTimestamp()).toBeNull();
    });

    it('should return alert timestamp after alert is sent', async () => {
      // Arrange
      process.env.AI_MAX_CONSECUTIVE_FAILURES = '1';
      process.env.AI_ALERT_EMAILS = 'admin@tattoopop.com';
      (service as any).emailSender = {
        sendEmailToContact: jest.fn().mockResolvedValue({}),
      };

      // Act
      await service.recordFailure('Err');

      // Assert
      expect(service.getLastAlertSentTimestamp()).toBeInstanceOf(Date);
    });
  });

  describe('getHealthDetails', () => {
    it('should return complete health details initial snapshot', () => {
      // Act
      const details = service.getHealthDetails();

      // Assert
      expect(details).toEqual({
        status: AiHealthStatus.HEALTHY,
        consecutiveFailures: 0,
        lastFailureTimestamp: null,
        lastErrorMessage: null,
        lastAlertSentTimestamp: null,
      });
    });

    it('should return updated health details snapshot after failures', async () => {
      // Arrange
      await service.recordFailure(new Error('API quota exceeded'));

      // Act
      const details = service.getHealthDetails();

      // Assert
      expect(details.status).toBe(AiHealthStatus.HEALTHY);
      expect(details.consecutiveFailures).toBe(1);
      expect(details.lastErrorMessage).toBe('API quota exceeded');
      expect(details.lastFailureTimestamp).toBeInstanceOf(Date);
    });
  });
});
