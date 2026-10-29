import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DowngradePremiumService } from './DowngradePremium.Service';
import { Client } from 'model/users/Client.entity';
import { Artist } from 'model/users/Artist.entity';
import { FirebaseService } from 'modules/firebase/Firebase.service';
import { RemovePersonalPhotosService } from './RemovePersonalPhotos.Service';
import { UserNotFoundException } from 'exceptions/UserNotFoundException';

describe('DowngradePremiumService', () => {
  let service: DowngradePremiumService;
  let clientRepository: any;
  let artistRepository: any;
  let firebaseService: any;
  let removePersonalPhotosService: any;

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
    removePersonalPhotosService = {
      removePersonal: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DowngradePremiumService,
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
        {
          provide: RemovePersonalPhotosService,
          useValue: removePersonalPhotosService,
        },
      ],
    }).compile();

    service = module.get<DowngradePremiumService>(DowngradePremiumService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('downgrade', () => {
    it('should downgrade successfully when client and artist exist', async () => {
      // Arrange
      const mockClient = { id: 'test-id', badge: 'premium-badge' } as any;
      const mockArtist = { id: 'test-id', premium: true } as any;

      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      artistRepository.findOne.mockResolvedValueOnce(mockArtist);

      // Act
      await service.downgrade('test-id' as any);

      // Assert
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-id' },
      });
      expect(artistRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-id' },
      });
      expect(removePersonalPhotosService.removePersonal).toHaveBeenCalledWith(
        'test-id',
      );
      expect(clientRepository.save).toHaveBeenCalledWith({
        ...mockClient,
        badge: null,
      });
      expect(artistRepository.save).toHaveBeenCalledWith({
        ...mockArtist,
        premium: false,
      });
      expect(firebaseService.changeCustomClaims).toHaveBeenCalledWith(
        'test-id',
        'premium',
        false,
      );
    });

    it('should downgrade successfully when only client exists (artist not found)', async () => {
      // Arrange
      const mockClient = { id: 'only-client', badge: 'premium-badge' } as any;

      clientRepository.findOne.mockResolvedValueOnce(mockClient);
      artistRepository.findOne.mockResolvedValueOnce(null);

      // Act
      await service.downgrade('only-client' as any);

      // Assert
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'only-client' },
      });
      expect(artistRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'only-client' },
      });
      expect(removePersonalPhotosService.removePersonal).toHaveBeenCalledWith(
        'only-client',
      );
      expect(clientRepository.save).toHaveBeenCalledWith({
        ...mockClient,
        badge: null,
      });
      // artistRepository.save should NOT be called because artist is null
      expect(artistRepository.save).not.toHaveBeenCalled();
      expect(firebaseService.changeCustomClaims).toHaveBeenCalledWith(
        'only-client',
        'premium',
        false,
      );
    });

    it('should throw UserNotFoundException when client does not exist', async () => {
      // Arrange
      clientRepository.findOne.mockResolvedValueOnce(null);
      // artistRepository.findOne can stay default (null)

      // Act & Assert
      await expect(service.downgrade('non-existent-id' as any)).rejects.toThrow(
        UserNotFoundException,
      );

      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'non-existent-id' },
      });
      // No further interactions should happen
      expect(removePersonalPhotosService.removePersonal).not.toHaveBeenCalled();
      expect(clientRepository.save).not.toHaveBeenCalled();
      expect(firebaseService.changeCustomClaims).not.toHaveBeenCalled();
    });
  });
});
