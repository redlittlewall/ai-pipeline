import { Test, TestingModule } from '@nestjs/testing';
import { MailerLiteService } from './MailerLite.Service';
import { FirebaseService } from 'modules/firebase/Firebase.service';

// Mock the external library used in the service
const mockAddSubscriber = jest.fn();
jest.mock('mailerlite-api-v2-node', () => {
  return {
    __esModule: true,
    default: jest.fn(() => ({
      addSubscriber: mockAddSubscriber,
    })),
  };
});

describe('MailerLiteService', () => {
  let service: MailerLiteService;
  let firebaseService: any;

  beforeEach(async () => {
    // Reset mocks before each test
    mockAddSubscriber.mockReset();

    firebaseService = {
      getUserFromUid: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailerLiteService,
        {
          provide: FirebaseService,
          useValue: firebaseService,
        },
      ],
    }).compile();

    service = module.get<MailerLiteService>(MailerLiteService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addSubscriber', () => {
    it('should execute addSubscriber successfully when user is valid', async () => {
      // Given (Arrange)
      firebaseService.getUserFromUid.mockResolvedValue({
        emailVerified: true,
        email: 'test@example.com',
        displayName: 'Test User',
      });
      mockAddSubscriber.mockResolvedValue({});

      // When (Act)
      await service.addSubscriber('test-id' as any, true as any);

      // Then (Assert)
      expect(firebaseService.getUserFromUid).toHaveBeenCalledWith('test-id');
      expect(mockAddSubscriber).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com',
          name: 'Test User',
          fields: { artist: true },
        }),
        expect.anything(),
      );
    });

    it('should not call mailerLite when email is not verified', async () => {
      // Given (Arrange)
      firebaseService.getUserFromUid.mockResolvedValue({
        emailVerified: false,
        email: 'test@example.com',
      });

      // When (Act)
      await service.addSubscriber('test-id' as any, true as any);

      // Then (Assert)
      expect(mockAddSubscriber).not.toHaveBeenCalled();
    });

    it('should not call mailerLite when email is an apple private relay address', async () => {
      // Given (Arrange)
      firebaseService.getUserFromUid.mockResolvedValue({
        emailVerified: true,
        email: 'user@privaterelay.appleid.com',
      });

      // When (Act)
      await service.addSubscriber('test-id' as any, true as any);

      // Then (Assert)
      expect(mockAddSubscriber).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully when mailerLite fails', async () => {
      // Given (Arrange)
      firebaseService.getUserFromUid.mockResolvedValue({
        emailVerified: true,
        email: 'test@example.com',
      });
      mockAddSubscriber.mockRejectedValue(new Error('API Error'));

      // When (Act)
      await service.addSubscriber('test-id' as any, true as any);

      // Then (Assert)
      expect(mockAddSubscriber).toHaveBeenCalled();
      // The service catches the error internally, so no exception should be thrown here
    });
  });

  describe('getSubscriber', () => {
    it('should execute getSubscriber successfully', async () => {
      // Given (Arrange)
      // Method is currently empty, just verifying it runs

      // When (Act)
      const result = await service.getSubscriber('test-id' as any);

      // Then (Assert)
      expect(result).toBeUndefined();
    });
  });
});
