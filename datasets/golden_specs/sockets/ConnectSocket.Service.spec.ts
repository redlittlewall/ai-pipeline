import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConnectSocketService } from './ConnectSocket.Service';
import { SocketsEntity } from 'model/sockets/Sockets.entity';

describe('ConnectSocketService', () => {
  let service: ConnectSocketService;
  let socketsEntityRepository: any;

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
    socketsEntityRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectSocketService,
        {
          provide: getRepositoryToken(SocketsEntity),
          useValue: socketsEntityRepository,
        },
      ],
    }).compile();

    service = module.get<ConnectSocketService>(ConnectSocketService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('connect', () => {
    beforeEach(() => {
      // Adicionando o mock do upsert que não estava no scaffold original
      socketsEntityRepository.upsert = jest.fn();
    });

    it('should execute connect successfully', async () => {
      // Given
      socketsEntityRepository.upsert.mockResolvedValue({} as any);

      // When
      await service.connect('test-id', 'test-val');

      // Then
      expect(socketsEntityRepository.upsert).toHaveBeenCalledWith(
        {
          clientId: 'test-id',
          socket: 'test-val',
          createdAt: expect.any(Date),
        },
        ['clientId'],
      );
    });

    it('should propagate error when upsert fails', async () => {
      // Given
      socketsEntityRepository.upsert.mockRejectedValue(
        new Error('Database error'),
      );

      // When & Then
      await expect(service.connect('test-id', 'test-val')).rejects.toThrow(
        'Database error',
      );
    });
  });
});
