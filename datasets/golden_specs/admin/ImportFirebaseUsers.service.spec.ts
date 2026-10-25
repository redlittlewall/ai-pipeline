import { Test, TestingModule } from '@nestjs/testing';
import { ImportFirebaseUsersService } from './ImportFirebaseUsers.service';
import { AdminFirebaseScriptsService } from './AdminFirebaseScripts.service';
import { LeadCollectorService } from '../../open/LeadCollector.service';

describe('ImportFirebaseUsersService', () => {
  let service: ImportFirebaseUsersService;
  let adminFirebaseScriptsService: any;
  let leadCollectorService: any;

  beforeEach(async () => {
    adminFirebaseScriptsService = {
      listAllUsers: jest.fn(),
    };
    leadCollectorService = {
      collect: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportFirebaseUsersService,
        {
          provide: AdminFirebaseScriptsService,
          useValue: adminFirebaseScriptsService,
        },
        {
          provide: LeadCollectorService,
          useValue: leadCollectorService,
        },
      ],
    }).compile();

    service = module.get<ImportFirebaseUsersService>(
      ImportFirebaseUsersService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('import', () => {
    it('should execute import successfully', async () => {
      // Given (Arrange)
      adminFirebaseScriptsService.listAllUsers.mockResolvedValueOnce({
        users: [
          {
            id: 'usr_1',
            email: 'user1@example.com',
            name: 'User One',
            isArtist: true,
            isAdmin: false,
            emailVerified: true,
            lastLogin: new Date('2023-01-01'),
          },
        ],
        nextPageToken: null,
      });
      leadCollectorService.collect.mockResolvedValueOnce(null);

      // When (Act)
      const result = await service.import();

      // Then (Assert)
      expect(result).toBeUndefined();
      expect(adminFirebaseScriptsService.listAllUsers).toHaveBeenCalledWith(
        null,
      );
      expect(leadCollectorService.collect).toHaveBeenCalledWith([
        {
          firebaseId: 'usr_1',
          email: 'user1@example.com',
          name: 'User One',
          isArtist: true,
          phone: '',
          emailVerified: true,
          lastLogin: new Date('2023-01-01'),
        },
      ]);
    });

    it('should handle pagination when nextPageToken is provided', async () => {
      // Given (Arrange)
      const mockDate = new Date('2023-01-01');
      adminFirebaseScriptsService.listAllUsers
        .mockResolvedValueOnce({
          users: [
            {
              id: 'usr_1',
              email: 'user1@example.com',
              name: 'User One',
              isArtist: true,
              isAdmin: false,
              emailVerified: true,
              lastLogin: mockDate,
            },
          ],
          nextPageToken: 'token_page_2',
        })
        .mockResolvedValueOnce({
          users: [
            {
              id: 'usr_2',
              email: 'user2@example.com',
              name: 'User Two',
              isArtist: false,
              isAdmin: false,
              emailVerified: false,
              lastLogin: mockDate,
            },
          ],
          nextPageToken: null,
        });

      leadCollectorService.collect.mockResolvedValueOnce(null);

      // When (Act)
      await service.import();

      // Then (Assert)
      expect(adminFirebaseScriptsService.listAllUsers).toHaveBeenCalledTimes(2);
      expect(adminFirebaseScriptsService.listAllUsers).toHaveBeenNthCalledWith(
        1,
        null,
      );
      expect(adminFirebaseScriptsService.listAllUsers).toHaveBeenNthCalledWith(
        2,
        'token_page_2',
      );
      expect(leadCollectorService.collect).toHaveBeenCalledWith([
        {
          firebaseId: 'usr_1',
          email: 'user1@example.com',
          name: 'User One',
          isArtist: true,
          phone: '',
          emailVerified: true,
          lastLogin: mockDate,
        },
        {
          firebaseId: 'usr_2',
          email: 'user2@example.com',
          name: 'User Two',
          isArtist: false,
          phone: '',
          emailVerified: false,
          lastLogin: mockDate,
        },
      ]);
    });

    it('should handle empty user list when firebase returns no users', async () => {
      // Given (Arrange)
      adminFirebaseScriptsService.listAllUsers.mockResolvedValueOnce({
        users: [],
        nextPageToken: null,
      });

      // When (Act)
      await service.import();

      // Then (Assert)
      expect(leadCollectorService.collect).toHaveBeenCalledWith([]);
    });

    it('should throw and log error when listing users fails', async () => {
      // Given (Arrange)
      const error = new Error('Firebase service unavailable');
      adminFirebaseScriptsService.listAllUsers.mockRejectedValueOnce(error);

      // When & Then (Act & Assert)
      await expect(service.import()).rejects.toThrow(
        'Firebase service unavailable',
      );
    });

    it('should throw error when lead collector service fails', async () => {
      // Given (Arrange)
      adminFirebaseScriptsService.listAllUsers.mockResolvedValueOnce({
        users: [
          {
            id: 'usr_1',
            email: 'user1@example.com',
            name: 'User One',
            isArtist: true,
            isAdmin: false,
            emailVerified: true,
            lastLogin: new Date(),
          },
        ],
        nextPageToken: null,
      });

      const collectorError = new Error('Lead collector error');
      leadCollectorService.collect.mockRejectedValueOnce(collectorError);

      // When & Then (Act & Assert)
      await expect(service.import()).rejects.toThrow('Lead collector error');
    });
  });
});
