import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SimpleSavePhotoInteractionService } from './SimpleSavePhotoInteraction.service';
import { ClientInteractTattoo } from 'model/users/relations/ClientInteractTattoo.entity';
import { ClientInteractionEnum } from 'enums/ClientInteractionEnum';

describe('SimpleSavePhotoInteractionService', () => {
  let service: SimpleSavePhotoInteractionService;
  let clientInteractTattooRepository: any;

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
    clientInteractTattooRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimpleSavePhotoInteractionService,
        {
          provide: getRepositoryToken(ClientInteractTattoo),
          useValue: clientInteractTattooRepository,
        },
      ],
    }).compile();

    service = module.get<SimpleSavePhotoInteractionService>(
      SimpleSavePhotoInteractionService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('save', () => {
    it('should create and save a new ClientInteractTattoo interaction (Happy Path)', async () => {
      // Given (Arrange)
      const clientId = 'client-123';
      const photoId = 'photo-456';
      const type = ClientInteractionEnum.LIKE;
      clientInteractTattooRepository.save.mockResolvedValueOnce({
        id: 'mock-id',
        interactionType: type,
        client: { id: clientId },
        tattoo: { id: photoId },
      } as any);

      // When (Act)
      const result = await service.save(clientId, photoId, type);

      // Then (Assert)
      expect(clientInteractTattooRepository.save).toHaveBeenCalledWith(
        expect.any(ClientInteractTattoo),
      );
      expect(result).toBeDefined();
      expect(result.id).toBe('mock-id');
    });

    it('should propagate errors when the repository fails to save (Sad Path)', async () => {
      // Given (Arrange)
      const error = new Error('Database connection failed');
      clientInteractTattooRepository.save.mockRejectedValueOnce(error);

      // When & Then (Act & Assert)
      await expect(
        service.save('c1', 'p1', ClientInteractionEnum.VIEW),
      ).rejects.toThrow('Database connection failed');
    });

    it('should handle interaction with optional value parameter (Branch Path)', async () => {
      // Given (Arrange)
      const value = 5;
      clientInteractTattooRepository.save.mockResolvedValueOnce({
        id: 'mock-id',
      } as any);

      // When (Act)
      const result = await service.save(
        'c1',
        'p1',
        ClientInteractionEnum.COMMENT,
        value,
      );

      // Then (Assert)
      expect(clientInteractTattooRepository.save).toHaveBeenCalled();
      expect(result.id).toBe('mock-id');
    });
  });
});
