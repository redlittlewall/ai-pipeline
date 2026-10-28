import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SaveArtistInteractionOnlyIfNotFoundService } from './SaveArtistInteractionOnlyIfNotFound.service';
import { ClientInteractArtist } from 'model/users/relations/ClientInteractArtist.entity';
import { ClientInteractionEnum } from 'enums/ClientInteractionEnum';

describe('SaveArtistInteractionOnlyIfNotFoundService', () => {
  let service: SaveArtistInteractionOnlyIfNotFoundService;
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
        SaveArtistInteractionOnlyIfNotFoundService,
        {
          provide: getRepositoryToken(ClientInteractArtist),
          useValue: clientInteractArtistRepository,
        },
      ],
    }).compile();

    service = module.get<SaveArtistInteractionOnlyIfNotFoundService>(
      SaveArtistInteractionOnlyIfNotFoundService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('save', () => {
    const clientId = 'client-123';
    const artistId = 'artist-456';
    const type = ClientInteractionEnum.LIKE;
    const reportMessage = 'Test message';

    it('should create and save a new interaction if not found (Happy Path)', async () => {
      // Given
      clientInteractArtistRepository.findOne.mockResolvedValueOnce(null);

      // When
      const result = await service.save(
        clientId,
        artistId,
        type,
        reportMessage,
      );

      // Then
      expect(clientInteractArtistRepository.findOne).toHaveBeenCalledWith({
        where: {
          artist: { id: artistId },
          interactionType: type,
          client: { id: clientId },
        },
      });
      expect(clientInteractArtistRepository.save).toHaveBeenCalled();
      expect(result.message).toBe(reportMessage);
    });

    it('should update existing interaction date and message if found', async () => {
      // Given
      const existingRelation = {
        createdAt: new Date('2020-01-01'),
        message: 'old message',
      } as any;
      clientInteractArtistRepository.findOne.mockResolvedValueOnce(
        existingRelation,
      );

      // When
      const result = await service.save(
        clientId,
        artistId,
        type,
        reportMessage,
      );

      // Then
      expect(clientInteractArtistRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          message: reportMessage,
        }),
      );
      expect(result.createdAt.getTime()).toBeGreaterThan(
        new Date('2020-01-01').getTime(),
      );
    });

    it('should propagate errors when repository fails (Sad Path)', async () => {
      // Given
      clientInteractArtistRepository.findOne.mockRejectedValueOnce(
        new Error('DB Error'),
      );

      // When & Then
      await expect(service.save(clientId, artistId, type)).rejects.toThrow(
        'DB Error',
      );
    });

    it('should save correctly without optional reportMessage', async () => {
      // Given
      clientInteractArtistRepository.findOne.mockResolvedValueOnce(null);

      // When
      const result = await service.save(clientId, artistId, type);

      // Then
      expect(clientInteractArtistRepository.save).toHaveBeenCalled();
      expect(result.message).toBeUndefined();
    });
  });
});
