import type { Hunk } from '@/types/git'

// Sample file diffs from the design. Several commits reuse the same diff.

export const expiryJobDiff: Hunk[] = [
  {
    oldStart: 0,
    newStart: 1,
    context: '',
    lines: [
      '+package com.example.inventory.reservation;',
      '+',
      '+import java.time.Clock;',
      '+import java.time.Instant;',
      '+import org.springframework.scheduling.annotation.Scheduled;',
      '+import org.springframework.stereotype.Component;',
      '+',
      '+@Component',
      '+public class ReservationExpiryJob {',
      '+',
      '+    private final ReservationRepository reservations;',
      '+    private final Clock clock;',
      '+',
      '+    public ReservationExpiryJob(ReservationRepository reservations, Clock clock) {',
      '+        this.reservations = reservations;',
      '+        this.clock = clock;',
      '+    }',
      '+',
      '+    @Scheduled(fixedDelayString = "${inventory.reservations.sweep-interval}")',
      '+    public void releaseExpired() {',
      '+        reservations.findExpiredBefore(Instant.now(clock))',
      '+                .forEach(Reservation::release);',
      '+    }',
      '+}',
    ],
  },
]

export const reservationConfigDiff: Hunk[] = [
  {
    oldStart: 9,
    newStart: 9,
    context: '',
    lines: [
      ' inventory:',
      '   pricing:',
      '     base-url: http://pricing:8080',
      '+  reservations:',
      '+    hold-duration: 15m',
      '+    sweep-interval: 60000',
    ],
  },
]

export const checkoutServiceDiff: Hunk[] = [
  {
    oldStart: 18,
    newStart: 18,
    context: 'public class CheckoutService {',
    lines: [
      '     private final OrderFactory orderFactory;',
      '     private final OrderRepository orders;',
      '+    private final ReservationService reservations;',
      '+    private final Duration holdDuration;',
      ' ',
      '-    public CheckoutService(OrderFactory orderFactory, OrderRepository orders) {',
      '+    public CheckoutService(OrderFactory orderFactory, OrderRepository orders,',
      '+                           ReservationService reservations,',
      '+                           @Value("${inventory.reservations.hold-duration}") Duration holdDuration) {',
      '         this.orderFactory = orderFactory;',
      '         this.orders = orders;',
      '+        this.reservations = reservations;',
      '+        this.holdDuration = holdDuration;',
      '     }',
    ],
  },
  {
    oldStart: 30,
    newStart: 36,
    context: 'public class CheckoutService {',
    lines: [
      '     @Transactional',
      '     public Order checkout(Cart cart) {',
      '         Order order = orderFactory.create(cart);',
      '+        cart.lines().forEach(line ->',
      '+                reservations.reserve(line.sku(), line.quantity(), holdDuration));',
      '         return orders.save(order);',
      '     }',
    ],
  },
]

export const skuLookupDiff: Hunk[] = [
  {
    oldStart: 27,
    newStart: 27,
    context: 'public class SkuLookup {',
    lines: [
      ' ',
      '     public Optional<Item> find(String sku) {',
      '-        return Optional.ofNullable(cache.get(sku.trim()));',
      '+        if (sku == null || sku.isBlank()) {',
      '+            return Optional.empty();',
      '+        }',
      '+        return Optional.ofNullable(cache.get(sku.trim()));',
      '     }',
    ],
  },
]

export const skuLookupTestDiff: Hunk[] = [
  {
    oldStart: 41,
    newStart: 41,
    context: 'class SkuLookupTest {',
    lines: [
      '         assertThat(lookup.find("  ABC-123 ")).contains(item);',
      '     }',
      '+',
      '+    @Test',
      '+    void returnsEmptyForNullOrBlankSku() {',
      '+        assertThat(lookup.find(null)).isEmpty();',
      '+        assertThat(lookup.find("   ")).isEmpty();',
      '+    }',
      ' }',
    ],
  },
]

export const reservationEntityDiff: Hunk[] = [
  {
    oldStart: 0,
    newStart: 1,
    context: '',
    lines: [
      '+package com.example.inventory.reservation;',
      '+',
      '+import jakarta.persistence.*;',
      '+import java.time.Instant;',
      '+',
      '+@Entity',
      '+public class Reservation {',
      '+',
      '+    @Id @GeneratedValue',
      '+    private Long id;',
      '+    private String sku;',
      '+    private int quantity;',
      '+    private Instant expiresAt;',
      '+    private boolean released;',
      '+',
      '+    public void release() {',
      '+        this.released = true;',
      '+    }',
      '+}',
    ],
  },
]

export const reservationRepositoryDiff: Hunk[] = [
  {
    oldStart: 0,
    newStart: 1,
    context: '',
    lines: [
      '+package com.example.inventory.reservation;',
      '+',
      '+import java.time.Instant;',
      '+import java.util.List;',
      '+import org.springframework.data.jpa.repository.JpaRepository;',
      '+',
      '+public interface ReservationRepository extends JpaRepository<Reservation, Long> {',
      '+',
      '+    List<Reservation> findByReleasedFalseAndExpiresAtBefore(Instant cutoff);',
      '+',
      '+    default List<Reservation> findExpiredBefore(Instant cutoff) {',
      '+        return findByReleasedFalseAndExpiresAtBefore(cutoff);',
      '+    }',
      '+}',
    ],
  },
]

export const pomBumpDiff: Hunk[] = [
  {
    oldStart: 5,
    newStart: 5,
    context: '<project>',
    lines: [
      '     <parent>',
      '         <groupId>org.springframework.boot</groupId>',
      '         <artifactId>spring-boot-starter-parent</artifactId>',
      '-        <version>3.3.2</version>',
      '+        <version>3.3.4</version>',
      '         <relativePath/>',
      '     </parent>',
    ],
  },
]

export const pricingClientDiff: Hunk[] = [
  {
    oldStart: 0,
    newStart: 1,
    context: '',
    lines: [
      '+package com.example.inventory.pricing;',
      '+',
      '+import java.math.BigDecimal;',
      '+import org.springframework.web.client.RestClient;',
      '+',
      '+public class PricingClient {',
      '+',
      '+    private final RestClient http;',
      '+',
      '+    public PricingClient(RestClient http) {',
      '+        this.http = http;',
      '+    }',
      '+',
      '+    public BigDecimal priceFor(String sku) {',
      '+        return http.get().uri("/prices/{sku}", sku)',
      '+                .retrieve()',
      '+                .body(BigDecimal.class);',
      '+    }',
      '+}',
    ],
  },
]

export const paginateItemsDiff: Hunk[] = [
  {
    oldStart: 22,
    newStart: 22,
    context: 'public class ItemController {',
    lines: [
      '     @GetMapping("/items")',
      '-    public List<Item> list() {',
      '-        return items.findAll();',
      '+    public Page<Item> list(@PageableDefault(size = 50) Pageable pageable) {',
      '+        return items.findAll(pageable);',
      '     }',
    ],
  },
]

export const ciCacheDiff: Hunk[] = [
  {
    oldStart: 18,
    newStart: 18,
    context: 'steps:',
    lines: [
      '       - uses: actions/setup-java@v4',
      '         with:',
      '           distribution: temurin',
      "           java-version: '21'",
      '+          cache: maven',
      '       - run: mvn -B verify',
    ],
  },
]

export const healthEndpointsDiff: Hunk[] = [
  {
    oldStart: 1,
    newStart: 1,
    context: '',
    lines: [
      ' spring:',
      '   application:',
      '     name: inventory-service',
      '+management:',
      '+  endpoints:',
      '+    web:',
      '+      exposure:',
      '+        include: health,info',
    ],
  },
]

export const readmeSetupDiff: Hunk[] = [
  {
    oldStart: 3,
    newStart: 3,
    context: '',
    lines: [
      ' ## Build',
      ' ',
      '+## Local setup',
      '+',
      '+1. Install JDK 21 and Docker.',
      '+2. Run `docker compose up -d` to start dependencies.',
      '+3. Run `./mvnw spring-boot:run`.',
      '+',
    ],
  },
]

export const gitignoreIdeDiff: Hunk[] = [
  {
    oldStart: 3,
    newStart: 3,
    context: '',
    lines: [' target/', ' *.log', '+.idea/', '+*.iml', '+.vscode/'],
  },
]

export const distrolessDiff: Hunk[] = [
  {
    oldStart: 1,
    newStart: 1,
    context: '',
    lines: [
      '-FROM eclipse-temurin:21-jre',
      '+FROM gcr.io/distroless/java21-debian12',
      ' WORKDIR /app',
      ' COPY target/app.jar app.jar',
      '-ENTRYPOINT ["java", "-jar", "app.jar"]',
      '+CMD ["app.jar"]',
    ],
  },
]

/** application.yml → application-prod.yml, shown in "Compare two files". */
export const sampleCompareDiff: Hunk[] = [
  {
    oldStart: 1,
    newStart: 1,
    context: '',
    lines: [
      ' spring:',
      '   datasource:',
      '-    url: jdbc:postgresql://localhost:5432/inventory',
      '-    username: inventory',
      '+    url: jdbc:postgresql://db.internal:5432/inventory',
      '+    username: ${DB_USER}',
      '+    password: ${DB_PASSWORD}',
      ' inventory:',
      '   pricing:',
      '-    base-url: http://localhost:8081',
      '+    base-url: http://pricing:8080',
      '   reservations:',
      '     hold-duration: 15m',
      '-logging:',
      '-  level:',
      '-    com.example: DEBUG',
    ],
  },
]
