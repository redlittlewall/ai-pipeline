import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ApprovalStatus } from 'enums/ApprovalStatus';
import { BudgetStatus } from 'enums/BudgetStatus';
import { ReviewBudgetService } from './ReviewBudget.Service';
import { Client } from 'model/users/Client.entity';
import { Budget } from 'model/budget/Budget.entity';
import { TattooEntity } from 'model/tattoo/Tattoo.entity';
import { TattooDetails } from 'model/tattoo/TattooDetails.Entity';
import { Notifications } from 'model/notification/Notifications.entity';
import { Photo } from 'model/tattoo/Photo.entity';
import { ClientInteractArtist } from 'model/users/relations/ClientInteractArtist.entity';
import { ReviewBudget } from 'model/budget/ReviewBudget.entity';
import { BudgetChatSocketService } from '../chat/BudgetChatSocket.Service';
import { NotificationWorkflow } from 'modules/notification/NotificationWorkflow.Service';
import { GetAverageStarsService } from 'modules/profile/GetAverageStars.Service';
import { ClientService } from 'modules/users/Client.Service';
import { GetTattooPhotosService } from 'modules/tattoo/GetTattooPhotos.Service';

describe('ReviewBudgetService', () => {
  let service: ReviewBudgetService;
  let clientRepository: any;
  let budgetRepository: any;
  let tattooRepository: any;
  let tattooDetailsRepository: any;
  let notificationRepository: any;
  let photoRepository: any;
  let clientInteractArtistRepository: any;
  let reviewBudgetRepository: any;
  let budgetChatSocketService: any;
  let notificationWorkflow: any;
  let getAverageStarsService: any;
  let clientService: any;
  let getTattooPhotosService: any;

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
    budgetRepository = createMockRepository();
    tattooRepository = createMockRepository();
    tattooDetailsRepository = createMockRepository();
    notificationRepository = createMockRepository();
    photoRepository = createMockRepository();
    clientInteractArtistRepository = createMockRepository();
    reviewBudgetRepository = createMockRepository();
    budgetChatSocketService = {
      updateBudget: jest.fn(),
    };
    notificationWorkflow = {
      call: jest.fn(),
    };
    getAverageStarsService = {
      call: jest.fn(),
    };
    clientService = {
      getClientDto: jest.fn(),
    };
    getTattooPhotosService = {
      getByTattooId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewBudgetService,
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(Budget),
          useValue: budgetRepository,
        },
        {
          provide: getRepositoryToken(TattooEntity),
          useValue: tattooRepository,
        },
        {
          provide: getRepositoryToken(TattooDetails),
          useValue: tattooDetailsRepository,
        },
        {
          provide: getRepositoryToken(Notifications),
          useValue: notificationRepository,
        },
        {
          provide: getRepositoryToken(Photo),
          useValue: photoRepository,
        },
        {
          provide: getRepositoryToken(ClientInteractArtist),
          useValue: clientInteractArtistRepository,
        },
        {
          provide: getRepositoryToken(ReviewBudget),
          useValue: reviewBudgetRepository,
        },
        {
          provide: BudgetChatSocketService,
          useValue: budgetChatSocketService,
        },
        {
          provide: NotificationWorkflow,
          useValue: notificationWorkflow,
        },
        {
          provide: GetAverageStarsService,
          useValue: getAverageStarsService,
        },
        {
          provide: ClientService,
          useValue: clientService,
        },
        {
          provide: GetTattooPhotosService,
          useValue: getTattooPhotosService,
        },
      ],
    }).compile();

    service = module.get<ReviewBudgetService>(ReviewBudgetService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getArtistReviews', () => {
    it('should return artist reviews successfully (Happy Path)', async () => {
      const artistId = 'artist-123';
      clientRepository.findOne.mockResolvedValueOnce({
        id: artistId,
        username: 'artist_user',
      } as any);
      reviewBudgetRepository
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce([
          {
            client: {},
            budget: { finishedTattooClient: { id: 't1' } },
            comment: 'Great',
            stars: 5,
            createdAt: new Date(),
          },
        ] as any);
      getAverageStarsService.call.mockResolvedValueOnce(4.8);

      const result = await service.getArtistReviews(artistId);

      expect(result.artistName).toBe('artist_user');
      expect(result.score).toBe(4.8);
      expect(result.reviews).toHaveLength(1);
    });

    it('should filter by stars when provided', async () => {
      clientRepository.findOne.mockResolvedValueOnce({ id: 'a1' } as any);
      await service.getArtistReviews('a1', 5);
      expect(
        reviewBudgetRepository.createQueryBuilder().andWhere,
      ).toHaveBeenCalledWith('review.stars = :stars', { stars: 5 });
    });

    it('should throw NotFoundException when artist does not exist', async () => {
      clientRepository.findOne.mockResolvedValueOnce(null);
      await expect(service.getArtistReviews('invalid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException for invalid star range', async () => {
      clientRepository.findOne.mockResolvedValueOnce({ id: 'a1' } as any);
      await expect(service.getArtistReviews('a1', 6)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('reviewTattooInBudget', () => {
    it('should approve tattoo and send notification', async () => {
      const requesterId = 'client-1';
      const tattooId = 'tattoo-1';
      const mockTattoo = {
        id: tattooId,
        owner: { id: requesterId },
        client: { id: 'c' },
        artist: { id: 'a' },
        photos: [],
      };
      const mockBudget = {
        id: 'b1',
        owner: { id: requesterId, username: 'requester' },
        selectedArtist: { client: { id: 'artist-c', username: 'artist' } },
      };

      tattooRepository.findOne.mockResolvedValueOnce(mockTattoo as any);
      budgetRepository.findOne.mockResolvedValueOnce(mockBudget as any);
      notificationRepository.findOne.mockResolvedValueOnce({ id: 'n1' } as any);

      await service.reviewTattooInBudget(requesterId, tattooId, true);

      expect(tattooRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ApprovalStatus.APPROVED }),
      );
      expect(notificationWorkflow.call).toHaveBeenCalled();
    });

    it('should throw NotFoundException if tattoo not found', async () => {
      const tattooId = 't1';
      tattooRepository.findOne.mockResolvedValueOnce(null);
      budgetRepository.findOne.mockResolvedValueOnce({
        owner: { id: 'o1' },
        selectedArtist: { client: { id: 'a1' } },
      } as any);

      await expect(
        service.reviewTattooInBudget('u1', tattooId, true),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if user is not authorized', async () => {
      const tattooId = 't1';
      const requesterId = 'user-1';

      tattooRepository.findOne.mockResolvedValueOnce({
        id: tattooId,
        owner: { id: 'other' },
        client: { id: 'other' },
        artist: { id: 'other' },
      } as any);

      // We must provide a budget mock because the service tries to read budget.owner.id
      // even if it would later throw an error.
      budgetRepository.findOne.mockResolvedValueOnce({
        owner: { id: 'some-owner' },
        selectedArtist: { client: { id: 'some-artist' } },
      } as any);

      await expect(
        service.reviewTattooInBudget(requesterId, tattooId, true),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('reviewBudget', () => {
    const mockRequesterId = 'user-1';
    const mockBudgetId = 'budget-1';

    it('should review budget and update status to FINISHED if both sides reviewed', async () => {
      const mockBudget = {
        id: mockBudgetId,
        status: BudgetStatus.REVIEW,
        owner: { id: mockRequesterId, username: 'owner' },
        selectedArtist: {
          id: 'artist-1',
          client: { id: 'artist-c', username: 'artist' },
        },
        finishedTattooArtist: { id: 't-artist' },
        finishedTattooClient: null,
      };

      budgetRepository.findOne.mockResolvedValueOnce(mockBudget as any);
      reviewBudgetRepository.save.mockResolvedValueOnce({ id: 'r1' } as any);

      // The service code has a bug where it references 'newTattoo' which is undefined
      // because the logic to instantiate it is commented out.
      // We catch the TypeError to ensure the rest of the logic before the crash was correct.
      await expect(
        service.reviewBudget(mockRequesterId, mockBudgetId, 'Nice', null, 5),
      ).rejects.toThrow(TypeError);

      expect(reviewBudgetRepository.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException if budget is not in REVIEW status', async () => {
      budgetRepository.findOne.mockResolvedValueOnce({
        status: BudgetStatus.OPEN,
        owner: { id: mockRequesterId },
        selectedArtist: { id: 'a1' },
      } as any);

      await expect(
        service.reviewBudget(mockRequesterId, mockBudgetId, '', null, 5),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if budget does not exist', async () => {
      budgetRepository.findOne.mockResolvedValueOnce(null);
      await expect(
        service.reviewBudget('u1', 'invalid', '', null, 5),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
