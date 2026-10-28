import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetClientLikeArtistService } from './GetClientLikeArtist.service';
import { ClientInteractArtist } from 'model/users/relations/ClientInteractArtist.entity';
import { ClientInteractionEnum } from 'enums/ClientInteractionEnum';
import { IsNull } from 'typeorm';

describe('GetClientLikeArtistService', () => {
  let service: GetClientLikeArtistService;
  let clientInteractArtistRepository: any;

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
    clientInteractArtistRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetClientLikeArtistService,
        {
          provide: getRepositoryToken(ClientInteractArtist),
          useValue: clientInteractArtistRepository,
        },
      ],
    }).compile();

    service = module.get<GetClientLikeArtistService>(
      GetClientLikeArtistService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('clientLikes', () => {
    it('should return true when count is greater than 0', async () => {
      // Given (Arrange)
      clientInteractArtistRepository.count.mockResolvedValueOnce(1);

      // When (Act)
      const result = await service.clientLikes('client-123', 'artist-456');

      // Then (Assert)
      expect(result).toBe(true);
      expect(clientInteractArtistRepository.count).toHaveBeenCalledWith({
        where: {
          client: { id: 'client-123' },
          artist: { id: 'artist-456' },
          interactionType: ClientInteractionEnum.LIKE,
          deletedAt: IsNull(),
        },
      });
    });

    it('should return false when count is 0', async () => {
      // Given (Arrange)
      clientInteractArtistRepository.count.mockResolvedValueOnce(0);

      // When (Act)
      const result = await service.clientLikes('client-123', 'artist-456');

      // Then (Assert)
      expect(result).toBe(false);
    });

    it('should return false when clientId is not provided', async () => {
      // When (Act)
      const result = await service.clientLikes(undefined as any, 'artist-456');

      // Then (Assert)
      expect(result).toBe(false);
      expect(clientInteractArtistRepository.count).not.toHaveBeenCalled();
    });

    it('should propagate errors when repository fails', async () => {
      // Given (Arrange)
      clientInteractArtistRepository.count.mockRejectedValueOnce(
        new Error('DB Error'),
      );

      // When & Then (Act & Assert)
      await expect(
        service.clientLikes('client-123', 'artist-456'),
      ).rejects.toThrow('DB Error');
    });
  });
});
