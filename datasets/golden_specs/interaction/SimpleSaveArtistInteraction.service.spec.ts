import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SimpleSaveArtistInteractionService } from './SimpleSaveArtistInteraction.service';
import { ClientInteractArtist } from 'model/users/relations/ClientInteractArtist.entity';
import { ClientInteractionEnum } from 'enums/ClientInteractionEnum';

describe('SimpleSaveArtistInteractionService', () => {
  let service: SimpleSaveArtistInteractionService;
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
        SimpleSaveArtistInteractionService,
        {
          provide: getRepositoryToken(ClientInteractArtist),
          useValue: clientInteractArtistRepository,
        },
      ],
    }).compile();

    service = module.get<SimpleSaveArtistInteractionService>(
      SimpleSaveArtistInteractionService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('save', () => {
    it('should return result when inputs are valid (Happy Path)', async () => {
      // Given (Arrange)
      const clientId = 'client-123';
      const artistId = 'artist-456';
      const type = ClientInteractionEnum.LIKE;
      const value = 10;
      const expectedResult = {
        id: 'mock-id',
        interactionType: type,
        client: clientId,
        artist: artistId,
        value,
      };

      clientInteractArtistRepository.save.mockResolvedValueOnce(
        expectedResult as any,
      );

      // When (Act)
      const result = await service.save(clientId, artistId, type, value);

      // Then (Assert)
      expect(result).toBeDefined();
      expect((result as any).client).toBe(clientId);
      expect((result as any).artist).toBe(artistId);
      expect(clientInteractArtistRepository.save).toHaveBeenCalled();
    });

    it('should save successfully even without value parameter', async () => {
      // Given (Arrange)
      const clientId = 'client-123';
      const artistId = 'artist-456';
      const type = ClientInteractionEnum.VIEW;

      // When (Act)
      const result = await service.save(clientId, artistId, type);

      // Then (Assert)
      expect(result).toBeDefined();
      expect(clientInteractArtistRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          client: clientId,
          artist: artistId,
          interactionType: type,
        }),
      );
    });

    it('should propagate errors when repository rejects (Sad Path)', async () => {
      // Given (Arrange)
      clientInteractArtistRepository.save.mockRejectedValueOnce(
        new Error('Database Error'),
      );

      // When & Then (Act & Assert)
      await expect(
        service.save('c' as any, 'a' as any, ClientInteractionEnum.SHARE),
      ).rejects.toThrow('Database Error');
    });
  });
});
