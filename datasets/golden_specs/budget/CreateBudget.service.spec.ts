import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CreateBudgetService } from './CreateBudget.service';
import { Budget } from 'model/budget/Budget.entity';
import { Artist } from 'model/users/Artist.entity';
import { Client } from 'model/users/Client.entity';
import { TattooEntity } from 'model/tattoo/Tattoo.entity';
import { BudgetExamplePhoto } from 'model/budget/BudgetExamplePhoto.entity';
import { BudgetNotificationService } from './notification/BudgetNotification.service';
import { BudgetChatSocketService } from './chat/BudgetChatSocket.Service';
import { BudgetType } from 'enums/BudgetType';
import { BudgetStatus } from 'enums/BudgetStatus';
import { BudgetNotificationType } from 'enums/BudgetNotificationType';

describe('CreateBudgetService', () => {
  let service: CreateBudgetService;
  let budgetRepository: any;
  let artistRepository: any;
  let clientRepository: any;
  let tattooEntityRepository: any;
  let budgetExamplePhotoRepository: any;
  let budgetNotificationService: any;
  let budgetChatSocketService: any;

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
            Promise.resolve({ ...(e || {}), id: e?.id || 'mock-id' }),
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
    budgetRepository = createMockRepository();
    artistRepository = createMockRepository();
    clientRepository = createMockRepository();
    tattooEntityRepository = createMockRepository();
    budgetExamplePhotoRepository = createMockRepository();
    budgetNotificationService = {
      notify: jest.fn(),
    };
    budgetChatSocketService = {
      updateBudget: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateBudgetService,
        {
          provide: getRepositoryToken(Budget),
          useValue: budgetRepository,
        },
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(TattooEntity),
          useValue: tattooEntityRepository,
        },
        {
          provide: getRepositoryToken(BudgetExamplePhoto),
          useValue: budgetExamplePhotoRepository,
        },
        {
          provide: BudgetNotificationService,
          useValue: budgetNotificationService,
        },
        {
          provide: BudgetChatSocketService,
          useValue: budgetChatSocketService,
        },
      ],
    }).compile();

    service = module.get<CreateBudgetService>(CreateBudgetService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createBudget', () => {
    const mockClient = {
      id: 'client-123',
      avatar: { id: 'avatar-1' },
      address: { id: 'address-1' },
    };

    const mockArtist = {
      id: 'artist-123',
      client: { id: 'artist-client-123' },
    };

    const mockTattoo = {
      id: 'tattoo-123',
      title: 'Tattoo Sample',
    };

    const mockRequestDto: any = {
      title: 'New Tattoo Budget',
      description: 'Budget description',
      size: { id: 'size-1' },
      bodyPart: { id: 'bodypart-1' },
      styles: [{ id: 'style-1', name: 'Blackwork' }],
      colors: ['black', 'grey'],
      photos: [
        { id: 'photo-1', url: 'http://example.com/photo1.jpg' },
        { id: 'photo-2', url: 'http://example.com/photo2.jpg' },
      ],
      selectedArtist: null,
      inspiredBy: null,
    };

    it('should create a PUBLIC budget when no artist is selected', async () => {
      // Arrange
      clientRepository.findOne.mockResolvedValueOnce(mockClient as any);
      budgetRepository.save.mockImplementationOnce((b: any) =>
        Promise.resolve({ ...b, id: 'budget-1' }),
      );

      // Act
      await service.createBudget('client-123', mockRequestDto);

      // Assert
      expect(clientRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'client-123' },
        relations: ['avatar', 'address'],
      });
      expect(artistRepository.findOne).not.toHaveBeenCalled();
      expect(budgetRepository.save).toHaveBeenCalled();
      expect(budgetExamplePhotoRepository.save).toHaveBeenCalledTimes(2);
      expect(budgetNotificationService.notify).not.toHaveBeenCalled();
      expect(budgetChatSocketService.updateBudget).toHaveBeenCalledWith(
        'client-123',
        null,
        'budget-1',
      );
    });

    it('should create a PRIVATE budget when selectedArtist is provided and set artistBudgetNumber to 1 if first budget', async () => {
      // Arrange
      const dtoWithArtist = {
        ...mockRequestDto,
        selectedArtist: { id: 'artist-123' },
      };
      clientRepository.findOne.mockResolvedValueOnce(mockClient as any);
      artistRepository.findOne.mockResolvedValueOnce(mockArtist as any);
      budgetRepository.findOne.mockResolvedValueOnce(null);
      budgetRepository.save.mockImplementationOnce((b: any) =>
        Promise.resolve({ ...b, id: 'budget-2' }),
      );

      // Act
      await service.createBudget('client-123', dtoWithArtist);

      // Assert
      expect(artistRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'artist-123' },
        relations: ['client'],
      });
      expect(budgetRepository.findOne).toHaveBeenCalledWith({
        where: { selectedArtist: { id: 'artist-123' } },
        order: { createdAt: 'DESC' },
      });
      expect(budgetNotificationService.notify).toHaveBeenCalledWith(
        expect.anything(),
        mockClient,
        mockArtist.client,
        BudgetNotificationType.NEW_BUDGET,
      );
      expect(budgetChatSocketService.updateBudget).toHaveBeenCalledWith(
        'client-123',
        'artist-123',
        'budget-2',
      );
    });

    it('should increment artistBudgetNumber when previous budget exists for selected artist', async () => {
      // Arrange
      const dtoWithArtist = {
        ...mockRequestDto,
        selectedArtist: { id: 'artist-123' },
      };
      clientRepository.findOne.mockResolvedValueOnce(mockClient as any);
      artistRepository.findOne.mockResolvedValueOnce(mockArtist as any);
      budgetRepository.findOne.mockResolvedValueOnce({
        artistBudgetNumber: 5,
      } as any);
      budgetRepository.save.mockImplementationOnce((b: any) =>
        Promise.resolve({ ...b, id: 'budget-3' }),
      );

      // Act
      await service.createBudget('client-123', dtoWithArtist);

      // Assert
      expect(budgetRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          artistBudgetNumber: 6,
        }),
      );
    });

    it('should attach inspiredBy tattoo entity when inspiredBy field is provided', async () => {
      // Arrange
      const dtoWithInspiredBy = {
        ...mockRequestDto,
        inspiredBy: { id: 'tattoo-123' },
      };
      clientRepository.findOne.mockResolvedValueOnce(mockClient as any);
      tattooEntityRepository.findOne.mockResolvedValueOnce(mockTattoo as any);
      budgetRepository.save.mockImplementationOnce((b: any) =>
        Promise.resolve({ ...b, id: 'budget-4' }),
      );

      // Act
      await service.createBudget('client-123', dtoWithInspiredBy);

      // Assert
      expect(tattooEntityRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'tattoo-123' },
      });
      expect(budgetRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          inspiredBy: mockTattoo,
        }),
      );
    });

    it('should throw an error when repository operation fails', async () => {
      // Arrange
      clientRepository.findOne.mockRejectedValueOnce(
        new Error('Database error'),
      );

      // Act & Assert
      await expect(
        service.createBudget('client-123', mockRequestDto),
      ).rejects.toThrow('Database error');
    });
  });
});
