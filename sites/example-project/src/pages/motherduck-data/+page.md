---
title: MotherDuck data
queries:
  - complaints: complaints.sql
  - complaints_years: complaints_years.sql
---

<BarChart 
    data={complaints}
    x=Year
    y=Complaints
/>

<Dropdown
    name=selected_year
    data={complaints_years}
    value=year
/>

```sql complaints_details
select year(created_date)::int as Year, complaint_type as Type, count(*)::int as Complaints
        from sample_data.nyc.service_requests
        where year = '${inputs.selected_year.value}'
        and agency_name = 'New York City Police Department'
        group by 1, 2
        order by 1, 3 desc
```

<DataTable data={complaints_details} />
