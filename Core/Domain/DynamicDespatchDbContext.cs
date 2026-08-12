using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Domain;

/// <summary>
/// Runtime DbContext used by every request. Extends DespatchContext with any
/// hand-authored entity configuration that shouldn't live in the Power Tools
/// scaffold. Route Viewer P0 + Recurring Routes Linehaul port added here so
/// a Power Tools regen cannot silently drop the FK / index config.
/// </summary>
public class DynamicDespatchDbContext(DbContextOptions options) : DespatchContext(options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Recurring Routes Linehaul port (2026-08-12). Backs the Linehaul tab
        // + Linehaul Roster tab. Table + indexes pre-existing in the shared
        // Despatch DB (verified via MCP). Mirror the on-disk shape so
        // `dotnet ef migrations add __probe` produces an empty diff.
        modelBuilder.Entity<DispatchLinehaulRunRoster>(entity =>
        {
            entity.ToTable("Dispatch_LinehaulRunRoster");
            entity.HasKey(e => e.LinehaulRunRosterId);
            entity.Property(e => e.IsActive).HasDefaultValue(true);
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("sysutcdatetime()");

            entity.HasOne(e => e.LinehaulRun)
                .WithMany(r => r.DispatchLinehaulRunRosters)
                .HasForeignKey(e => e.LinehaulRunId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(e => e.Courier)
                .WithMany()
                .HasForeignKey(e => e.CourierId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(e => e.Agent)
                .WithMany()
                .HasForeignKey(e => e.AgentId)
                .OnDelete(DeleteBehavior.NoAction);

            // Filtered unique indexes match on-disk:
            //   UX_LinehaulRunRoster_Run_DOW_Active  WHERE IsActive=1 AND RosterDate IS NULL
            //   UX_LinehaulRunRoster_Run_Date_Active WHERE IsActive=1 AND RosterDate IS NOT NULL
            entity.HasIndex(e => new { e.LinehaulRunId, e.DayOfWeek })
                .HasDatabaseName("UX_LinehaulRunRoster_Run_DOW_Active")
                .HasFilter("[IsActive]=(1) AND [RosterDate] IS NULL")
                .IsUnique();
            entity.HasIndex(e => new { e.LinehaulRunId, e.RosterDate })
                .HasDatabaseName("UX_LinehaulRunRoster_Run_Date_Active")
                .HasFilter("[IsActive]=(1) AND [RosterDate] IS NOT NULL")
                .IsUnique();
            entity.HasIndex(e => e.AgentId)
                .HasDatabaseName("IX_LinehaulRunRoster_AgentId");
        });

        // Extend the auto-scaffolded TblbulkLinehaulRun config for the new
        // DefaultAgent + Speed navs added via TblbulkLinehaulRun.Partial.cs.
        // The base FromDepot / ToDepot / Courier config in DespatchContext.cs
        // stays as-is.
        modelBuilder.Entity<TblbulkLinehaulRun>(entity =>
        {
            entity.HasOne(e => e.DefaultAgent)
                .WithMany()
                .HasForeignKey(e => e.DefaultAgentId)
                .OnDelete(DeleteBehavior.NoAction);
            entity.HasOne(e => e.Speed)
                .WithMany()
                .HasForeignKey(e => e.SpeedId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }
}
