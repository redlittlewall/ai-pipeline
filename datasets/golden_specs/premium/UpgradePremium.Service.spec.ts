import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UpgradePremiumService } from './UpgradePremium.Service';
import { Client } from 'model/users/Client.entity';
import { Artist } from 'model/users/Artist.entity';
import { FirebaseService } from 'modules/firebase/Firebase.service';
import { UserNotFoundException } from 'exceptions/UserNotFoundException';

describe('UpgradePremiumService', () => {
  let service: UpgradePremiumService;
  let clientRepository: any;
  let artistRepository: any;
  let firebaseService: any;

  beforeEach(async () => {
    const createQueryBuilderMock = () => {
      const qb: any = new Proxy(
        {},
        {
          get(target, prop) {
            if (prop === 'then') return undefined;
            if (!(prop in target)) {
              target[prop] = jest.fn().mockImplementation((...args: any[]) => {
                if (args.length > 0 && typeof args[0] === 'function') {
                  args[0](qb);
                } else if (
                  args.length > 0 &&
                  args[0] &&
                  typeof args[0].whereFactory === 'function'
                ) {
                  args[0].whereFactory(qb);
                }
                return qb;
              });
            }
            return target[prop];
          },
        },
      );
      qb.getOne = jest.fn().mockResolvedValue(null);
      qb.getMany = jest.fn().mockResolvedValue([]);
      qb.getRawOne = jest.fn().mockResolvedValue(null);
      qb.getRawMany = jest.fn().mockResolvedValue([]);
      qb.getCount = jest.fn().mockResolvedValue(0);
      qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
      qb.execute = jest.fn().mockResolvedValue({ affected: 1, raw: [] });
      return qb;
    };

    const createMockRepository = () => {
      const qb = createQueryBuilderMock();
      return {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([]),
        findAndCount: jest.fn().mockResolvedValue([[], 0]),
        save: jest
          .fn()
          .mockImplementation((e: any) =>
            Promise.resolve({ id: 'mock-id', ...(e || {}) }),
          ),
        create: jest.fn().mockImplementation((e: any) => e),
        update: jest
          .fn()
          .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
        delete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        softDelete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        restore: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        count: jest.fn().mockResolvedValue(0),
        exist: jest.fn().mockResolvedValue(false),
        remove: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
    };
    clientRepository = createMockRepository();
    artistRepository = createMockRepository();
    firebaseService = {
      changeCustomClaims: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpgradePremiumService,
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: FirebaseService,
          useValue: firebaseService,
        },
      ],
    }).compile();

    service = module.get<UpgradePremiumService>(UpgradePremiumService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('upgrade', () => {
    it('should upgrade client when client exists and artist does not exist', async () => {
      // Arrange
      clientRepository.findOne.mockResolvedValueOnce({ id: 'test-id' } as any);
      artistRepository.findOne.mockResolvedValueOnce(null);
      firebaseService.changeCustomClaims.mockResolvedValueOnce(undefined);

      // Act
      const result = await service.upgrade('test-id' as any);

      // Assert
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-id' },
      });
      expect(artistRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-id' },
      });
      expect(artistRepository.save).not.toHaveBeenCalled();
      expect(firebaseService.changeCustomClaims).toHaveBeenCalledWith(
        'test-id',
        'premium',
        true,
      );
      expect(result).toBeUndefined(); // method returns void
    });

    it('should upgrade client and set artist premium when artist exists', async () => {
      // Arrange
      const mockArtist = { id: 'test-id', premium: false } as any;
      clientRepository.findOne.mockResolvedValueOnce({ id: 'test-id' } as any);
      artistRepository.findOne.mockResolvedValueOnce(mockArtist);
      firebaseService.changeCustomClaims.mockResolvedValueOnce(undefined);

      // Act
      await service.upgrade('test-id' as any);

      // Assert
      expect(artistRepository.save).toHaveBeenCalledWith({
        ...mockArtist,
        premium: true,
      });
      expect(firebaseService.changeCustomClaims).toHaveBeenCalledWith(
        'test-id',
        'premium',
        true,
      );
    });

    it('should throw UserNotFoundException when client is not found', async () => {
      // Arrange
      clientRepository.findOne.mockResolvedValueOnce(null);
      // artistRepository.findOne will not be reached but keep default

      // Act & Assert
      await expect(service.upgrade('nonexistent-id' as any)).rejects.toThrow(
        UserNotFoundException,
      );
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'nonexistent-id' },
      });
    });

    it('should propagate errors from FirebaseService', async () => {
      // Arrange
      clientRepository.findOne.mockResolvedValueOnce({ id: 'test-id' } as any);
      artistRepository.findOne.mockResolvedValueOnce(null);
      firebaseService.changeCustomClaims.mockRejectedValueOnce(
        new Error('Firebase error'),
      );

      // Act & Assert
      await expect(service.upgrade('test-id' as any)).rejects.toThrow(
        'Firebase error',
      );
      expect(firebaseService.changeCustomClaims).toHaveBeenCalledWith(
        'test-id',
        'premium',
        true,
      );
    });
  });
});
