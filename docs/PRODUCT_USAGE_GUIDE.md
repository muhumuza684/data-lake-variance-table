# Data Lake Variance Table — usage guide

## Purpose

Actual-versus-plan comparison table with previous values, forecasts, totals, and variance indicators.

## Sample data

Use the CSV in sample-data to reproduce a reference layout. Map category and grouping columns to the visual's categorical roles and map Actual, Plan, or Metric values to the visual's measure roles. Replace the sample with governed organisational data before production use.

## Responsive behavior

The visual supports compact, standard, and wide report-area layouts. Compact mode prioritises primary values, standard mode exposes the normal analytical surface, and wide mode shows the full labels, controls, and supporting context.

## Accessibility

Interactive controls must remain keyboard reachable, focus indicators must remain visible, and meaning must not rely on colour alone. Use labels, legends, status text, and numeric values together.

## Validation

Run 
pm ci, 
pm run typecheck, 
pm run test:ci, 
pm run lint, and 
pm run package. GitHub Actions stores the generated .pbiviz file as a workflow artifact.